"""
Risk Checker — Combines LLM-based analysis with rule-based checks
to produce a comprehensive quality assessment of clinical documents.

This is the DIFFERENTIATOR of the application:
- ICH-GCP E6(R2) protocol completeness scoring
- Cross-section consistency validation
- Safety gap detection
- Overall document quality score (0–100)
"""

import re


# ── Section Checklists per Document Type ──────────────────────────────────

# ICH-GCP E6(R2) required protocol elements and their detection keywords
ICH_GCP_PROTOCOL_SECTIONS = {
    "title_and_protocol_id": {
        "label": "Title & Protocol ID",
        "keywords": ["protocol number", "protocol title", "study title", "protocol id"],
        "weight": 5,
    },
    "objectives": {
        "label": "Study Objectives",
        "keywords": ["objective", "primary objective", "secondary objective", "aim of the study"],
        "weight": 10,
    },
    "study_design": {
        "label": "Study Design",
        "keywords": ["study design", "randomized", "double-blind", "open-label", "parallel", "crossover"],
        "weight": 10,
    },
    "endpoints": {
        "label": "Endpoints / Outcomes",
        "keywords": ["primary endpoint", "secondary endpoint", "primary outcome", "efficacy endpoint"],
        "weight": 10,
    },
    "study_population": {
        "label": "Study Population",
        "keywords": ["inclusion criteria", "exclusion criteria", "eligibility", "patient population"],
        "weight": 10,
    },
    "treatment_description": {
        "label": "Treatment Description",
        "keywords": ["investigational product", "dosage", "route of administration", "treatment arm", "placebo"],
        "weight": 8,
    },
    "safety_monitoring": {
        "label": "Safety Monitoring",
        "keywords": ["adverse event", "serious adverse event", "safety monitoring", "dsmb", "data safety"],
        "weight": 10,
    },
    "statistical_methods": {
        "label": "Statistical Methods",
        "keywords": ["statistical analysis", "sample size", "power calculation", "intent to treat", "p-value"],
        "weight": 8,
    },
    "ethical_considerations": {
        "label": "Ethical Considerations",
        "keywords": ["informed consent", "ethics committee", "irb", "institutional review board", "declaration of helsinki"],
        "weight": 7,
    },
    "data_management": {
        "label": "Data Management",
        "keywords": ["data management", "case report form", "crf", "data collection", "electronic data"],
        "weight": 5,
    },
    "quality_assurance": {
        "label": "Quality Assurance",
        "keywords": ["quality assurance", "monitoring plan", "audit", "source data verification"],
        "weight": 5,
    },
    "schedule_of_assessments": {
        "label": "Schedule of Assessments",
        "keywords": ["schedule of assessment", "study visit", "visit schedule", "study procedures"],
        "weight": 7,
    },
    "references": {
        "label": "References / Bibliography",
        "keywords": ["reference", "bibliography", "literature"],
        "weight": 5,
    },
}

# ICH E3 required sections for Clinical Study Reports
ICH_E3_CSR_SECTIONS = {
    "title_page": {
        "label": "Title Page",
        "keywords": ["clinical study report", "report title", "study report", "final report"],
        "weight": 5,
    },
    "synopsis": {
        "label": "Synopsis",
        "keywords": ["synopsis", "summary of clinical study", "study synopsis"],
        "weight": 8,
    },
    "ethics": {
        "label": "Ethics / IRB Approval",
        "keywords": ["ethics committee", "irb", "institutional review board", "ethical conduct", "informed consent"],
        "weight": 8,
    },
    "investigators_and_sites": {
        "label": "Investigators & Study Sites",
        "keywords": ["investigator", "study site", "study center", "principal investigator", "participating site"],
        "weight": 5,
    },
    "study_objectives": {
        "label": "Study Objectives",
        "keywords": ["objective", "primary objective", "secondary objective", "aim of the study"],
        "weight": 8,
    },
    "study_design": {
        "label": "Study Design & Plan",
        "keywords": ["study design", "randomized", "double-blind", "open-label", "study plan", "treatment period"],
        "weight": 10,
    },
    "study_population": {
        "label": "Study Population",
        "keywords": ["patient disposition", "subject disposition", "enrolled", "randomized patients", "intent to treat", "demographics"],
        "weight": 10,
    },
    "efficacy_results": {
        "label": "Efficacy Results",
        "keywords": ["efficacy analysis", "efficacy results", "primary efficacy", "primary endpoint result", "efficacy evaluation"],
        "weight": 12,
    },
    "safety_results": {
        "label": "Safety Results",
        "keywords": ["safety analysis", "safety results", "adverse event", "serious adverse event", "safety summary", "safety evaluation"],
        "weight": 12,
    },
    "statistical_methods": {
        "label": "Statistical Methods",
        "keywords": ["statistical analysis", "statistical method", "analysis population", "sample size", "confidence interval"],
        "weight": 10,
    },
    "discussion": {
        "label": "Discussion & Interpretation",
        "keywords": ["discussion", "interpretation", "clinical significance", "benefit-risk"],
        "weight": 8,
    },
    "conclusion": {
        "label": "Conclusion",
        "keywords": ["conclusion", "overall conclusion", "study conclusion"],
        "weight": 7,
    },
    "references": {
        "label": "References / Appendices",
        "keywords": ["reference", "bibliography", "appendix", "appendices"],
        "weight": 4,
    },
}

# Generic clinical document — lighter checklist for unknown types
GENERIC_CLINICAL_SECTIONS = {
    "study_identification": {
        "label": "Study Identification",
        "keywords": ["study title", "protocol number", "study number", "study id", "clinical study report"],
        "weight": 8,
    },
    "objectives_or_purpose": {
        "label": "Objectives / Purpose",
        "keywords": ["objective", "purpose", "aim", "goal of the study"],
        "weight": 10,
    },
    "methodology": {
        "label": "Methodology / Design",
        "keywords": ["study design", "method", "methodology", "randomized", "open-label", "procedure"],
        "weight": 10,
    },
    "results_or_findings": {
        "label": "Results / Findings",
        "keywords": ["result", "finding", "outcome", "analysis", "efficacy", "conclusion"],
        "weight": 10,
    },
    "safety_information": {
        "label": "Safety Information",
        "keywords": ["adverse event", "safety", "serious adverse event", "tolerability", "side effect"],
        "weight": 10,
    },
    "regulatory_context": {
        "label": "Regulatory & Ethical Context",
        "keywords": ["informed consent", "ethics committee", "irb", "regulatory", "ich", "gcp"],
        "weight": 7,
    },
}

# ICH-GCP 4.8 required elements for Informed Consent Forms (rule-based)
ICH_GCP_CONSENT_SECTIONS = {
    "study_purpose": {
        "label": "Study Purpose",
        "keywords": ["purpose of the study", "study purpose", "research study", "aim of this study"],
        "weight": 10,
    },
    "procedures": {
        "label": "Study Procedures",
        "keywords": ["procedure", "what will happen", "study visit", "blood sample", "examination"],
        "weight": 10,
    },
    "duration": {
        "label": "Duration of Participation",
        "keywords": ["duration", "how long", "length of participation", "weeks", "months", "period of"],
        "weight": 7,
    },
    "risks": {
        "label": "Risks & Discomforts",
        "keywords": ["risk", "discomfort", "side effect", "adverse", "danger", "harm"],
        "weight": 10,
    },
    "benefits": {
        "label": "Benefits",
        "keywords": ["benefit", "advantage", "may help", "potential benefit"],
        "weight": 8,
    },
    "alternatives": {
        "label": "Alternatives to Participation",
        "keywords": ["alternative", "other option", "other treatment", "instead of"],
        "weight": 7,
    },
    "confidentiality": {
        "label": "Confidentiality",
        "keywords": ["confidential", "privacy", "personal information", "data protection", "hipaa"],
        "weight": 8,
    },
    "voluntary_participation": {
        "label": "Voluntary Participation",
        "keywords": ["voluntary", "free to", "choose to", "right to refuse", "no penalty"],
        "weight": 10,
    },
    "withdrawal_rights": {
        "label": "Right to Withdraw",
        "keywords": ["withdraw", "discontinue", "stop participating", "leave the study", "right to stop"],
        "weight": 10,
    },
    "compensation": {
        "label": "Compensation & Costs",
        "keywords": ["compensation", "payment", "cost", "reimburse", "financial", "injury"],
        "weight": 7,
    },
    "contact_information": {
        "label": "Contact Information",
        "keywords": ["contact", "telephone", "phone", "email", "call", "reach"],
        "weight": 8,
    },
    "irb_information": {
        "label": "IRB / Ethics Committee Information",
        "keywords": ["irb", "institutional review board", "ethics committee", "iec", "review board"],
        "weight": 5,
    },
}

# Map doc_type → appropriate section checklist
_SECTION_MAP = {
    "protocol": ICH_GCP_PROTOCOL_SECTIONS,
    "csr": ICH_E3_CSR_SECTIONS,
    "consent_form": ICH_GCP_CONSENT_SECTIONS,
    "clinical_document": GENERIC_CLINICAL_SECTIONS,
}

# Guideline label per doc_type for user-facing messages
_GUIDELINE_LABELS = {
    "protocol": "ICH-GCP E6(R2)",
    "csr": "ICH E3",
    "consent_form": "ICH-GCP E6(R2) Section 4.8",
    "clinical_document": "General Clinical",
}


def run_rule_based_checks(text: str, entities: dict, doc_type: str = "protocol") -> dict:
    """
    Run rule-based (non-LLM) checks on the document.
    These complement the LLM-based risk analysis for reliability.

    Returns:
        {
            "section_coverage": dict,     # Which ICH-GCP sections are present
            "completeness_score": float,  # 0-100 based on section coverage
            "rule_findings": list[dict],  # Rule-based findings
        }
    """
    text_lower = text.lower()
    findings = []

    # Pick checklist for the detected doc type
    required_sections = _SECTION_MAP.get(doc_type, GENERIC_CLINICAL_SECTIONS)
    guideline = _GUIDELINE_LABELS.get(doc_type, "Clinical")

    # 1. Section Coverage Check (doc-type-specific)
    section_coverage = {}
    total_weight = 0
    covered_weight = 0

    for section_id, info in required_sections.items():
        found = any(kw in text_lower for kw in info["keywords"])
        section_coverage[section_id] = {
            "label": info["label"],
            "present": found,
            "weight": info["weight"],
        }
        total_weight += info["weight"]
        if found:
            covered_weight += info["weight"]
        else:
            findings.append({
                "category": "Missing Element",
                "severity": "HIGH" if info["weight"] >= 8 else "MEDIUM",
                "title": f"Missing: {info['label']}",
                "description": f"The required section '{info['label']}' was not detected in the document.",
                "section_reference": "N/A",
                "recommendation": f"Add a section covering {info['label']} to comply with {guideline} guidelines.",
            })

    completeness_score = (covered_weight / total_weight * 100) if total_weight > 0 else 0

    # 2. Abbreviation Check — flag undefined abbreviations
    abbreviation_findings = _check_abbreviations(text)
    findings.extend(abbreviation_findings)

    # 3. Entity-based checks (only for protocols — CSRs and generic docs have different entity expectations)
    if doc_type in ("protocol", "consent_form"):
        entity_findings = _check_entities(entities)
        findings.extend(entity_findings)

    # 4. Ambiguity Check — common vague terms in clinical docs
    ambiguity_findings = _check_ambiguous_language(text)
    findings.extend(ambiguity_findings)

    return {
        "section_coverage": section_coverage,
        "completeness_score": round(completeness_score, 1),
        "rule_findings": findings,
    }


def calculate_quality_score(
    completeness_score: float,
    llm_findings: list[dict],
    rule_findings: list[dict],
) -> dict:
    """
    Calculate an overall document quality score (0–100).

    Scoring breakdown:
    - Section completeness: 40% weight
    - Risk findings penalty: 40% weight (fewer findings = higher score)
    - Entity richness: 20% weight
    """
    # Section completeness contributes 40%
    completeness_component = completeness_score * 0.4

    # Risk findings penalty contributes 40%
    all_findings = llm_findings + rule_findings
    high_count = sum(1 for f in all_findings if f.get("severity") == "HIGH")
    medium_count = sum(1 for f in all_findings if f.get("severity") == "MEDIUM")
    low_count = sum(1 for f in all_findings if f.get("severity") == "LOW")

    # Penalty: HIGH=-10, MEDIUM=-5, LOW=-2 (from base 100)
    penalty = min(100, high_count * 10 + medium_count * 5 + low_count * 2)
    findings_component = max(0, 100 - penalty) * 0.4

    # Base 20% for having content at all
    base_component = 20

    score = completeness_component + findings_component + base_component
    score = max(0, min(100, round(score, 1)))

    # Determine grade
    if score >= 85:
        grade = "A"
        label = "Excellent"
        color = "green"
    elif score >= 70:
        grade = "B"
        label = "Good"
        color = "blue"
    elif score >= 55:
        grade = "C"
        label = "Needs Improvement"
        color = "orange"
    else:
        grade = "D"
        label = "Significant Issues"
        color = "red"

    return {
        "score": score,
        "grade": grade,
        "label": label,
        "color": color,
        "breakdown": {
            "completeness": round(completeness_component, 1),
            "risk_penalty": round(findings_component, 1),
            "base": base_component,
        },
        "finding_counts": {
            "high": high_count,
            "medium": medium_count,
            "low": low_count,
            "total": len(all_findings),
        },
    }


# ── Internal Rule Checks ──────────────────────────────────────────────────


def _check_abbreviations(text: str) -> list[dict]:
    """Detect uppercase abbreviations that may not be defined."""
    # Find all abbreviations (2-6 uppercase letters)
    abbrevs = set(re.findall(r"\b[A-Z]{2,6}\b", text))
    # Common abbreviations that don't need definition
    common = {
        "US", "UK", "EU", "FDA", "ICH", "GCP", "IRB", "IEC", "AE", "SAE",
        "PI", "IV", "IM", "SC", "PO", "BID", "TID", "QD", "PRN", "PDF",
        "ID", "OR", "CI", "HR", "RR", "OS", "PFS", "DFS", "ORR", "CR",
        "PR", "SD", "PD", "DLT", "MTD", "RP2D", "CRF", "EDC", "SOC",
        "MedDRA", "WHO", "ICF", "IP", "ITT", "PP", "DSMB", "DMC", "SAP",
        "CSR", "IB", "SOP", "QA", "QC", "CRA", "CRO", "GMP", "II", "III",
        "BMI", "ECG", "CT", "MRI", "CBC", "ALT", "AST", "HIV", "DNA", "RNA",
    }
    undefined = abbrevs - common
    findings = []

    # Only flag if there are many undefined abbreviations
    if len(undefined) > 5:
        sample = ", ".join(list(undefined)[:8])
        findings.append({
            "category": "Ambiguous Language",
            "severity": "LOW",
            "title": "Multiple undefined abbreviations",
            "description": f"Found {len(undefined)} abbreviations that may not be defined: {sample}...",
            "section_reference": "Throughout document",
            "recommendation": "Add a List of Abbreviations section or define each abbreviation on first use.",
        })

    return findings


def _check_entities(entities: dict) -> list[dict]:
    """Check extracted entities for completeness and issues."""
    findings = []

    if not entities.get("drugs") or len(entities["drugs"]) == 0:
        findings.append({
            "category": "Missing Element",
            "severity": "HIGH",
            "title": "No drug/treatment information extracted",
            "description": "The system could not extract any drug names or treatment information from the document.",
            "section_reference": "Treatment Description",
            "recommendation": "Ensure the document clearly describes the investigational product(s) and dosage regimen.",
        })

    if not entities.get("primary_endpoints") or len(entities["primary_endpoints"]) == 0:
        findings.append({
            "category": "Missing Element",
            "severity": "HIGH",
            "title": "No primary endpoints extracted",
            "description": "The system could not identify primary endpoint(s) in the document.",
            "section_reference": "Endpoints",
            "recommendation": "Primary endpoints must be clearly defined per ICH-GCP requirements.",
        })

    if not entities.get("inclusion_criteria") and not entities.get("exclusion_criteria"):
        findings.append({
            "category": "Missing Element",
            "severity": "MEDIUM",
            "title": "No eligibility criteria extracted",
            "description": "Neither inclusion nor exclusion criteria were detected.",
            "section_reference": "Study Population",
            "recommendation": "Clearly state inclusion and exclusion criteria for the study population.",
        })

    return findings


def _check_ambiguous_language(text: str) -> list[dict]:
    """Flag vague language patterns that cause regulatory queries."""
    findings = []
    text_lower = text.lower()

    ambiguous_patterns = [
        (r"\bas\s+needed\b", "Vague dosing: 'as needed'", "Specify exact criteria for when the treatment should be administered."),
        (r"\bif\s+appropriate\b", "Vague condition: 'if appropriate'", "Define specific criteria for what constitutes 'appropriate'."),
        (r"\bat\s+the\s+discretion\s+of\b", "Subjective decision criterion", "Provide objective criteria instead of investigator discretion where possible."),
        (r"\bmay\s+be\s+adjusted\b", "Vague dose modification", "Specify exact dose adjustment rules with clear thresholds."),
        (r"\bgenerally\b", "Imprecise language: 'generally'", "Replace with specific criteria or remove hedging language."),
        (r"\bapproximately\b.*(?:patients|subjects)", "Imprecise sample size", "Specify the exact planned sample size with statistical justification."),
    ]

    for pattern, title, recommendation in ambiguous_patterns:
        matches = re.findall(pattern, text_lower)
        if matches:
            findings.append({
                "category": "Ambiguous Language",
                "severity": "LOW",
                "title": title,
                "description": f"Found {len(matches)} instance(s) of potentially ambiguous language that could trigger regulatory queries.",
                "section_reference": "Multiple sections",
                "recommendation": recommendation,
            })

    return findings
