"""
Fix Suggestion Generator — Produces concrete fix/rewrite suggestions
for each risk finding.

- In LIVE mode: calls the LLM once per finding (batched) for tailored text
- In DEMO mode: uses a deterministic template engine (zero LLM cost)
"""

from __future__ import annotations


# ── Template-based fix suggestions (zero LLM cost) ────────────────────────

_CATEGORY_FIXES: dict[str, dict] = {
    "rescue_criteria": {
        "template": (
            "Add explicit rescue criteria to Section {section}:\n"
            "• HbA1c > 11% confirmed at any scheduled visit → initiate rescue therapy\n"
            "• FPG > 270 mg/dL on 2 consecutive visits (≥ 1 week apart) → initiate rescue therapy\n"
            "• Document the rescue medication options, dose ranges, and statistical handling of post-rescue data."
        ),
        "type": "protocol_text",
    },
    "dsmb_oversight": {
        "template": (
            "Add a DSMB Charter reference in Section {section}:\n"
            "• Reference DSMB Charter document number and version\n"
            "• Include pre-specified stopping boundaries (O'Brien-Fleming alpha-spending)\n"
            "• Define unblinding rules and quorum requirements."
        ),
        "type": "protocol_text",
    },
    "sample_size": {
        "template": (
            "Complete the sample size justification in Section {section}:\n"
            "• State assumed SD (e.g., 1.1% for HbA1c change)\n"
            "• State expected dropout rate (e.g., 15%)\n"
            "• Confirm alpha = 0.05 two-sided, power = 90%\n"
            "• Show: N = 2 × [(Zα/2 + Zβ)² × 2σ²] / δ² + dropout adjustment"
        ),
        "type": "statistical",
    },
    "multiplicity": {
        "template": (
            "Add multiplicity control to Section {section}:\n"
            "• Implement gatekeeping strategy: test secondary endpoints only if primary is statistically significant (p < 0.05)\n"
            "• Among secondary endpoints, apply Hochberg step-up procedure\n"
            "• Pre-specify the testing hierarchy in the SAP."
        ),
        "type": "statistical",
    },
    "missing_data": {
        "template": (
            "Specify missing data strategy in Section {section}:\n"
            "• Primary analysis: Mixed Model Repeated Measures (MMRM)\n"
            "• Sensitivity: Multiple Imputation under Missing-at-Random\n"
            "• Stress test: Tipping-point analysis per ICH E9(R1) estimand framework\n"
            "• Define intercurrent events and their handling strategies."
        ),
        "type": "statistical",
    },
    "safety_monitoring": {
        "template": (
            "Clarify washout periods in Section {section} by drug class:\n"
            "• Sulfonylureas: ≥ 4 weeks (long-acting metabolites)\n"
            "• Thiazolidinediones: ≥ 8 weeks (prolonged PD effects)\n"
            "• DPP-4 inhibitors: ≥ 2 weeks\n"
            "• SGLT2 inhibitors: ≥ 2 weeks\n"
            "• GLP-1 agonists: ≥ 5 half-lives of the specific agent."
        ),
        "type": "protocol_text",
    },
    "ich_gcp_structure": {
        "template": (
            "Add Investigator Qualifications section per ICH M11 Section 14 and ICH-GCP 4.1:\n"
            "• Require current CV of PI and sub-investigators\n"
            "• Document GCP training certificates (within 3 years)\n"
            "• Include delegation of authority log template\n"
            "• Reference 21 CFR Part 312.53 for US sites."
        ),
        "type": "regulatory",
    },
    "ich_m11_structure": {
        "template": (
            "Add missing ICH M11 section to {section}:\n"
            "• Review ICH M11 template structure (Sections 2-16) for required content\n"
            "• Include all mandatory subsections per the harmonised protocol template\n"
            "• Ensure alignment with ICH E6(R2) GCP requirements\n"
            "• Submit protocol amendment through document control."
        ),
        "type": "regulatory",
    },
    "ich_e3_structure": {
        "template": (
            "Add missing ICH E3 section to {section}:\n"
            "• Review ICH E3 CSR structure (Sections 2-16) for required content\n"
            "• Include all data tables, figures, and appendices per E3\n"
            "• Ensure safety and efficacy data are presented per regulatory expectations\n"
            "• Cross-reference protocol and SAP for consistency."
        ),
        "type": "regulatory",
    },
    "ich_gcp_48": {
        "template": (
            "Add missing ICH-GCP 4.8.10 consent element to {section}:\n"
            "• Review all 21 required elements of 4.8.10 (a through u)\n"
            "• Ensure language is understandable to a lay person\n"
            "• Include all legally required disclosures per local regulations\n"
            "• Obtain IRB/IEC approval for revised consent form."
        ),
        "type": "regulatory",
    },
    "deviation_handling": {
        "template": (
            "Add Protocol Deviation Procedures per ICH M11 Section 13:\n"
            "• Define categories: Major (affects safety/data integrity) vs. Minor\n"
            "• Reporting timelines: Major → Sponsor within 24h, IRB within 5 business days\n"
            "• Require CAPA documentation for all major deviations\n"
            "• Track in deviation log with root cause analysis."
        ),
        "type": "regulatory",
    },
    "endpoint_definition": {
        "template": (
            "Add Patient-Reported Outcomes to Section {section}:\n"
            "• Include DTSQ (Diabetes Treatment Satisfaction Questionnaire) as exploratory endpoint\n"
            "• Consider EQ-5D-5L for health-related quality of life\n"
            "• Administer at Baseline, Week 12, and Week 24\n"
            "• Pre-specify MID (Minimally Important Difference) thresholds."
        ),
        "type": "protocol_text",
    },
    "data_integrity": {
        "template": (
            "Add Record Retention requirements per ICH M11 Section 15:\n"
            "• Minimum 15 years from study completion, or per local regulations, whichever is longer\n"
            "• Specify storage conditions (secure, access-controlled, climate-controlled)\n"
            "• Define electronic record backup and migration procedures\n"
            "• Identify responsible party for long-term archival."
        ),
        "type": "regulatory",
    },
}

# Generic fallback for unknown categories
_GENERIC_FIX = {
    "template": (
        "Address this finding in Section {section}:\n"
        "• Review the identified gap against ICH M11 (protocol), ICH E3 (CSR), or ICH-GCP 4.8 (consent)\n"
        "• Draft specific document language to close the gap\n"
        "• Submit amendment through document control with change justification\n"
        "• Obtain IRB/IEC approval before implementation."
    ),
    "type": "general",
}


def generate_fix_suggestions(findings: list[dict]) -> list[dict]:
    """
    Generate concrete fix/rewrite suggestions for each finding.
    Uses template-based approach (zero LLM cost). Modifies findings in-place.
    Returns the modified findings list.
    """
    for f in findings:
        category = f.get("category", "")
        section = f.get("section_reference", "the relevant section")
        fix_info = _CATEGORY_FIXES.get(category, _GENERIC_FIX)

        suggestion_text = fix_info["template"].replace("{section}", section)
        # Fix "in Section Section X" → "in Section X"
        suggestion_text = suggestion_text.replace("Section Section ", "Section ").replace("section Section ", "Section ")

        f["fix_suggestion"] = {
            "text": suggestion_text,
            "type": fix_info["type"],
            "confidence": "high" if category in _CATEGORY_FIXES else "medium",
        }

    return findings


def generate_fix_with_llm(finding: dict, source_text: str, model: str = "gpt-4.1") -> dict:
    """
    Generate a more detailed fix using the LLM. Only called in live mode.
    Falls back to template-based suggestion on failure.
    """
    from backend.services.llm_analyzer import call_llm
    from backend.config import LLM_TEMPERATURE_ANALYSIS, LLM_MAX_TOKENS_SHORT

    prompt = (
        f"FINDING: {finding.get('title', '')}\n"
        f"SEVERITY: {finding.get('severity', '')}\n"
        f"DESCRIPTION: {finding.get('description', '')}\n"
        f"EVIDENCE: {finding.get('evidence', '')}\n"
        f"SECTION: {finding.get('section_reference', '')}\n\n"
        "RELEVANT SOURCE TEXT (excerpt):\n"
        f"{source_text[:1500]}\n\n"
        "Generate a SPECIFIC fix suggestion with:\n"
        "1. Exact protocol language to add or modify (2-4 sentences)\n"
        "2. Where to insert it (section number)\n"
        "3. Regulatory justification (cite ICH M11 for protocols, ICH E3 for CSRs, or ICH-GCP 4.8 for consent)\n\n"
        "Return ONLY the fix text, no JSON."
    )

    try:
        result = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_ANALYSIS,
            max_tokens=LLM_MAX_TOKENS_SHORT,
            system_prompt=(
                "You are a clinical protocol remediation expert. Given a regulatory "
                "finding, generate precise, actionable fix language that can be inserted "
                "directly into the document. Cite ICH M11, ICH E3, or ICH-GCP 4.8 as "
                "appropriate. Be concise and specific."
            ),
        )
        return {
            "text": result,
            "type": "llm_generated",
            "confidence": "high",
        }
    except Exception:
        # Fall back to template
        category = finding.get("category", "")
        section = finding.get("section_reference", "the relevant section")
        fix_info = _CATEGORY_FIXES.get(category, _GENERIC_FIX)
        return {
            "text": fix_info["template"].replace("{section}", section),
            "type": fix_info["type"],
            "confidence": "medium",
        }
