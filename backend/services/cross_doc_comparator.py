"""
Cross-Document Comparator — Accepts multiple related documents (Protocol,
CSR, Consent Form) from the same study.  Extracts structured fields from
each and performs *cross-document* comparison to find inconsistencies,
missing information, and semantic differences.

Works in two modes:
  DEMO  — returns pre-built comparison data (zero LLM cost)
  LIVE  — uses LLM for semantic extraction + comparison
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher

from backend.config import (
    DEMO_MODE as _DEFAULT_DEMO,
    LLM_TEMPERATURE_EXTRACTION, LLM_TEMPERATURE_ANALYSIS,
    LLM_MAX_TOKENS_MEDIUM, LLM_MAX_TOKENS_LONG,
)


# ═══════════════════════════════════════════════════════════════════════════
# 1.  Structured-field extraction (per document)
# ═══════════════════════════════════════════════════════════════════════════

# The canonical fields we extract and compare across documents
COMPARISON_FIELDS = [
    "age_criteria",
    "dosage",
    "inclusion_criteria",
    "exclusion_criteria",
    "primary_endpoints",
    "secondary_endpoints",
    "safety_risks",
    "sample_size",
    "study_phase",
    "study_duration",
    "drug_name",
]

_EXTRACTION_PROMPT = """\
You are a clinical document analyst.  Extract the following structured fields
from this clinical {doc_type} text.  Return **only** valid JSON — no commentary.

Fields to extract (use null if absent):
{{
  "age_criteria": "e.g. 18-75 years",
  "dosage": "e.g. Metformin XR 1000 mg once daily",
  "inclusion_criteria": ["criterion 1", "criterion 2", ...],
  "exclusion_criteria": ["criterion 1", "criterion 2", ...],
  "primary_endpoints": ["endpoint 1", ...],
  "secondary_endpoints": ["endpoint 1", ...],
  "safety_risks": ["risk 1", ...],
  "sample_size": "e.g. 500 patients",
  "study_phase": "e.g. Phase III",
  "study_duration": "e.g. 24 weeks",
  "drug_name": "e.g. Metformin XR"
}}

--- DOCUMENT TEXT (first 4000 chars) ---
{text}
"""


def extract_fields_with_llm(text: str, doc_type: str, model: str) -> dict:
    """Call LLM to pull structured fields from a single document."""
    from backend.services.llm_analyzer import call_llm, _parse_json_response

    prompt = _EXTRACTION_PROMPT.replace("{doc_type}", doc_type).replace("{text}", text[:4000])
    raw = call_llm(
        prompt, model=model,
        temperature=LLM_TEMPERATURE_EXTRACTION,
        max_tokens=LLM_MAX_TOKENS_MEDIUM,
        system_prompt=(
            "You are a clinical document data extractor. Extract structured fields "
            "exactly as they appear in the source text. Return valid JSON only. "
            "Use null for fields not found — never fabricate values."
        ),
        response_format="json",
    )
    parsed = _parse_json_response(raw)
    if not parsed:
        return {k: None for k in COMPARISON_FIELDS}
    # Normalise into expected shape
    out = {}
    for k in COMPARISON_FIELDS:
        v = parsed.get(k)
        if isinstance(v, list):
            out[k] = [str(i) for i in v if i]
        elif v:
            out[k] = str(v)
        else:
            out[k] = None
    return out


def extract_fields_from_entities(entities: dict, text: str) -> dict:
    """
    Build the structured-field dict from already-extracted entities and raw
    text heuristics.  Used in Demo mode (no extra LLM call).
    """
    age = None
    m = re.search(r"(\d{1,3}\s*[-–to]+\s*\d{1,3})\s*years", text[:5000], re.I)
    if m:
        age = m.group(0).strip()

    dosage_parts = []
    for d in entities.get("drugs", []):
        if isinstance(d, dict):
            name = d.get("name", "")
            dose = d.get("dosage", "")
            if name and dose:
                dosage_parts.append(f"{name} {dose}")
            elif name:
                dosage_parts.append(name)
    dosage = "; ".join(dosage_parts) if dosage_parts else None

    drug_name = None
    if entities.get("drugs"):
        d = entities["drugs"][0]
        drug_name = d.get("name") if isinstance(d, dict) else str(d)

    return {
        "age_criteria": age,
        "dosage": dosage,
        "inclusion_criteria": entities.get("inclusion_criteria") or None,
        "exclusion_criteria": entities.get("exclusion_criteria") or None,
        "primary_endpoints": entities.get("primary_endpoints") or None,
        "secondary_endpoints": entities.get("secondary_endpoints") or None,
        "safety_risks": [
            ae.get("event", str(ae)) if isinstance(ae, dict) else str(ae)
            for ae in entities.get("adverse_events", [])
        ] or None,
        "sample_size": entities.get("sample_size") if entities.get("sample_size") != "Not mentioned" else None,
        "study_phase": entities.get("study_phase") if entities.get("study_phase") != "Not mentioned" else None,
        "study_duration": None,  # not in standard entities
        "drug_name": drug_name,
    }


# ═══════════════════════════════════════════════════════════════════════════
# 2.  Cross-document comparison logic
# ═══════════════════════════════════════════════════════════════════════════

_SEMANTIC_COMPARE_PROMPT = """\
You are a clinical regulatory expert.  Two clinical trial documents describe
the same study but may have inconsistencies.

Compare these corresponding fields from a {doc_a_type} and a {doc_b_type}.
For EACH field, classify the match as:
  "match"       — semantically identical
  "minor_diff"  — same meaning, different wording
  "mismatch"    — actual substantive difference (potential regulatory issue)
  "missing"     — field present in one document but absent/null in the other

Return ONLY valid JSON — an array of objects:
[
  {{
    "field": "<field name>",
    "status": "match|minor_diff|mismatch|missing",
    "detail": "<brief explanation of the difference>",
    "severity": "HIGH|MEDIUM|LOW",
    "doc_a_value": "<value or null>",
    "doc_b_value": "<value or null>"
  }},
  ...
]

--- {doc_a_type} fields ---
{fields_a}

--- {doc_b_type} fields ---
{fields_b}
"""


def _compare_pair_with_llm(
    fields_a: dict, fields_b: dict,
    doc_a_type: str, doc_b_type: str,
    model: str,
) -> list[dict]:
    """Use LLM for semantic comparison of two documents' extracted fields."""
    from backend.services.llm_analyzer import call_llm, _parse_json_response

    prompt = (
        _SEMANTIC_COMPARE_PROMPT
        .replace("{doc_a_type}", doc_a_type)
        .replace("{doc_b_type}", doc_b_type)
        .replace("{fields_a}", json.dumps(fields_a, indent=2, default=str))
        .replace("{fields_b}", json.dumps(fields_b, indent=2, default=str))
    )
    raw = call_llm(
        prompt, model=model,
        temperature=LLM_TEMPERATURE_ANALYSIS,
        max_tokens=LLM_MAX_TOKENS_LONG,
        system_prompt=(
            "You are a clinical regulatory expert performing cross-document "
            "consistency analysis. Compare corresponding fields and identify "
            "mismatches that could create regulatory risk. Return valid JSON array."
        ),
        response_format="json",
    )
    parsed = _parse_json_response(raw)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and "comparisons" in parsed:
        return parsed["comparisons"]
    return []


def _similarity(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _list_similarity(a: list | None, b: list | None) -> float:
    if not a or not b:
        return 0.0
    a_set = {x.lower().strip() for x in a}
    b_set = {x.lower().strip() for x in b}
    if not a_set and not b_set:
        return 1.0
    intersection = a_set & b_set
    union = a_set | b_set
    return len(intersection) / len(union) if union else 0.0


def _compare_pair_rule_based(
    fields_a: dict, fields_b: dict,
    doc_a_type: str, doc_b_type: str,
) -> list[dict]:
    """Rule-based / fuzzy comparison — used as fallback or in demo mode."""
    results = []
    field_labels = {
        "age_criteria": "Age Criteria",
        "dosage": "Drug Dosage",
        "inclusion_criteria": "Inclusion Criteria",
        "exclusion_criteria": "Exclusion Criteria",
        "primary_endpoints": "Primary Endpoints",
        "secondary_endpoints": "Secondary Endpoints",
        "safety_risks": "Safety Risks",
        "sample_size": "Sample Size",
        "study_phase": "Study Phase",
        "study_duration": "Study Duration",
        "drug_name": "Drug Name",
    }

    for field in COMPARISON_FIELDS:
        a_val = fields_a.get(field)
        b_val = fields_b.get(field)
        label = field_labels.get(field, field)

        # Both missing — skip
        if not a_val and not b_val:
            continue

        # One missing
        if not a_val or not b_val:
            present_in = doc_a_type if a_val else doc_b_type
            missing_in = doc_b_type if a_val else doc_a_type
            severity = "HIGH" if field in ("safety_risks", "dosage", "primary_endpoints") else "MEDIUM"
            results.append({
                "field": label,
                "status": "missing",
                "detail": f"Present in {present_in} but missing in {missing_in}",
                "severity": severity,
                "doc_a_value": _format_val(a_val),
                "doc_b_value": _format_val(b_val),
            })
            continue

        # Both present — compare
        if isinstance(a_val, list) and isinstance(b_val, list):
            sim = _list_similarity(a_val, b_val)
        elif isinstance(a_val, list) or isinstance(b_val, list):
            sim = 0.3  # type mismatch
        else:
            sim = _similarity(str(a_val), str(b_val))

        if sim >= 0.92:
            status, severity = "match", "LOW"
            detail = "Consistent across documents"
        elif sim >= 0.65:
            status, severity = "minor_diff", "LOW"
            detail = "Same meaning, minor wording difference"
        elif sim >= 0.35:
            status, severity = "mismatch", "MEDIUM"
            detail = "Partial inconsistency detected"
        else:
            severity = "HIGH" if field in ("dosage", "age_criteria", "primary_endpoints", "safety_risks", "sample_size") else "MEDIUM"
            status = "mismatch"
            detail = "Significant difference — potential regulatory risk"

        results.append({
            "field": label,
            "status": status,
            "detail": detail,
            "severity": severity,
            "doc_a_value": _format_val(a_val),
            "doc_b_value": _format_val(b_val),
        })
    return results


def _format_val(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, list):
        return "; ".join(str(x) for x in v[:5])
    return str(v)


# ═══════════════════════════════════════════════════════════════════════════
# 3.  Scoring
# ═══════════════════════════════════════════════════════════════════════════

def _compute_risk_score(all_issues: list[dict]) -> dict:
    """Compute an overall risk score from all cross-doc issues."""
    if not all_issues:
        return {"score": 100, "grade": "A", "label": "No issues detected"}

    total_penalty = 0
    for issue in all_issues:
        if issue.get("status") == "match":
            continue
        sev = (issue.get("severity") or "LOW").upper()
        if sev == "HIGH":
            total_penalty += 15
        elif sev == "MEDIUM":
            total_penalty += 8
        else:
            total_penalty += 3

    score = max(0, 100 - total_penalty)
    if score >= 85:
        grade, label = "A", "Documents are well-aligned"
    elif score >= 70:
        grade, label = "B", "Minor inconsistencies found"
    elif score >= 50:
        grade, label = "C", "Notable inconsistencies — review needed"
    elif score >= 30:
        grade, label = "D", "Significant inconsistencies — regulatory risk"
    else:
        grade, label = "F", "Critical mismatches — immediate remediation required"

    return {"score": score, "grade": grade, "label": label}


# ═══════════════════════════════════════════════════════════════════════════
# 4.  Public API — run_cross_document_comparison
# ═══════════════════════════════════════════════════════════════════════════

def run_cross_document_comparison(
    documents: list[dict],
    use_llm: bool = False,
    model: str = "gpt-4.1",
) -> dict:
    """
    Compare 2-3 related clinical documents.

    Each element in *documents* must contain:
        filename   : str
        doc_type   : str  ("protocol" | "csr" | "consent_form")
        doc_type_label : str
        text       : str  (raw document text)
        entities   : dict  (already-extracted entity dict)
        summary    : str
        quality    : dict  ({score, grade})
        risk       : dict  ({findings, total_findings, high_count, ...})

    Returns a comparison result dict.
    """
    if len(documents) < 2:
        return {"error": "Need at least 2 documents to compare"}

    # Step 1: Extract structured fields per document
    doc_fields: list[dict] = []
    doc_summaries: list[dict] = []

    for doc in documents:
        if use_llm:
            fields = extract_fields_with_llm(doc["text"], doc.get("doc_type", "document"), model)
        else:
            fields = extract_fields_from_entities(doc.get("entities", {}), doc.get("text", ""))
        doc_fields.append(fields)

        doc_summaries.append({
            "filename": doc["filename"],
            "doc_type": doc.get("doc_type_label") or doc.get("doc_type", ""),
            "quality_score": doc.get("quality", {}).get("score", 0),
            "quality_grade": doc.get("quality", {}).get("grade", "—"),
            "finding_counts": {
                "total": doc.get("risk", {}).get("total_findings", 0),
                "high": doc.get("risk", {}).get("high_count", 0),
                "medium": doc.get("risk", {}).get("medium_count", 0),
                "low": doc.get("risk", {}).get("low_count", 0),
            },
            "extracted_fields": fields,
            "summary": doc.get("summary", "")[:500],
        })

    # Step 2: Pairwise cross-document comparison
    all_pairs: list[dict] = []
    all_issues: list[dict] = []

    for i in range(len(documents)):
        for j in range(i + 1, len(documents)):
            doc_a_label = doc_summaries[i]["doc_type"] or documents[i]["filename"]
            doc_b_label = doc_summaries[j]["doc_type"] or documents[j]["filename"]

            if use_llm:
                comparisons = _compare_pair_with_llm(
                    doc_fields[i], doc_fields[j],
                    doc_a_label, doc_b_label,
                    model,
                )
            else:
                comparisons = _compare_pair_rule_based(
                    doc_fields[i], doc_fields[j],
                    doc_a_label, doc_b_label,
                )

            pair_result = {
                "doc_a": documents[i]["filename"],
                "doc_a_type": doc_a_label,
                "doc_b": documents[j]["filename"],
                "doc_b_type": doc_b_label,
                "field_comparisons": comparisons,
                "issues": [c for c in comparisons if c.get("status") != "match"],
            }
            all_pairs.append(pair_result)
            all_issues.extend(pair_result["issues"])

    # Step 3: Overall risk score
    risk_score = _compute_risk_score(all_issues)

    # Step 4: Build summary stats
    issue_counts = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for iss in all_issues:
        sev = (iss.get("severity") or "LOW").upper()
        issue_counts[sev] = issue_counts.get(sev, 0) + 1

    return {
        "document_count": len(documents),
        "documents": doc_summaries,
        "pairwise_comparisons": all_pairs,
        "total_issues": len(all_issues),
        "issue_counts": issue_counts,
        "risk_score": risk_score,
    }
