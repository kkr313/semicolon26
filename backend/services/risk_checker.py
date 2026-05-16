"""
Risk Checker — Combines LLM-based analysis with rule-based checks
to produce a comprehensive quality assessment of clinical documents.

This is the DIFFERENTIATOR of the application:
- ICH M11 protocol completeness scoring (international protocol template)
- ICH E3 CSR structure verification
- ICH-GCP 4.8 informed consent element checking
- Cross-section consistency validation
- Safety gap detection
- Overall document quality score (0–100)
"""

import re


# ── Section Checklists per Document Type ──────────────────────────────────

# ICH M11 — Clinical Electronic Structured Harmonised Protocol Template
# The global standard for clinical trial protocol structure.
# Sections aligned with ICH M11 (R1) template numbering.
ICH_M11_PROTOCOL_SECTIONS = {
    "title_page": {
        "label": "Title Page & Protocol ID (M11 Section 1)",
        "keywords": ["protocol number", "protocol title", "study title", "protocol id", "eudract", "nct"],
        "weight": 5,
    },
    "synopsis": {
        "label": "Protocol Synopsis (M11 Section 2)",
        "keywords": ["synopsis", "protocol summary", "study synopsis", "overview of study"],
        "weight": 5,
    },
    "schedule_of_activities": {
        "label": "Schedule of Activities (M11 Section 3)",
        "keywords": ["schedule of activities", "schedule of assessment", "study visit", "visit schedule", "study procedures", "soa"],
        "weight": 8,
    },
    "introduction": {
        "label": "Introduction & Rationale (M11 Section 4)",
        "keywords": ["introduction", "background", "rationale", "scientific rationale", "benefit-risk", "known risk"],
        "weight": 7,
    },
    "objectives_estimands": {
        "label": "Objectives & Estimands (M11 Section 5)",
        "keywords": ["objective", "primary objective", "secondary objective", "estimand", "intercurrent event"],
        "weight": 10,
    },
    "study_design": {
        "label": "Study Design (M11 Section 6)",
        "keywords": ["study design", "randomized", "double-blind", "open-label", "parallel", "crossover", "adaptive design"],
        "weight": 10,
    },
    "study_population": {
        "label": "Study Population (M11 Section 7)",
        "keywords": ["inclusion criteria", "exclusion criteria", "eligibility", "patient population", "screen failure"],
        "weight": 10,
    },
    "treatments": {
        "label": "Study Intervention & Concomitant Therapy (M11 Section 8)",
        "keywords": ["investigational product", "dosage", "route of administration", "treatment arm", "placebo", "concomitant", "prohibited medication"],
        "weight": 9,
    },
    "discontinuation": {
        "label": "Discontinuation & Withdrawal (M11 Section 9)",
        "keywords": ["discontinuation", "withdrawal", "stopping rule", "rescue", "early termination", "study completion"],
        "weight": 7,
    },
    "assessments": {
        "label": "Study Assessments / Endpoints (M11 Section 10)",
        "keywords": ["primary endpoint", "secondary endpoint", "efficacy endpoint", "assessment", "biomarker", "patient-reported outcome"],
        "weight": 10,
    },
    "safety_reporting": {
        "label": "Adverse Events & Safety Reporting (M11 Section 11)",
        "keywords": ["adverse event", "serious adverse event", "safety monitoring", "sae reporting", "pregnancy", "overdose"],
        "weight": 10,
    },
    "statistics": {
        "label": "Statistical Considerations (M11 Section 12)",
        "keywords": ["statistical analysis", "sample size", "power calculation", "intent to treat", "missing data", "interim analysis", "multiplicity"],
        "weight": 10,
    },
    "oversight": {
        "label": "Oversight & Monitoring (M11 Section 13)",
        "keywords": ["data safety monitoring", "dsmb", "monitoring plan", "quality assurance", "audit", "source data verification", "oversight committee"],
        "weight": 8,
    },
    "ethics": {
        "label": "Ethics & Regulatory (M11 Section 14)",
        "keywords": ["informed consent", "ethics committee", "irb", "institutional review board", "declaration of helsinki", "regulatory authority"],
        "weight": 7,
    },
    "data_management": {
        "label": "Data Management & Records (M11 Section 15)",
        "keywords": ["data management", "case report form", "crf", "electronic data", "data collection", "record retention", "source document"],
        "weight": 5,
    },
    "references": {
        "label": "References & Appendices (M11 Section 16)",
        "keywords": ["reference", "bibliography", "appendix", "appendices", "abbreviation"],
        "weight": 4,
    },
}

# ICH E3 — Structure and Content of Clinical Study Reports
# Full section-level checklist for CSR completeness.
ICH_E3_CSR_SECTIONS = {
    "title_page": {
        "label": "Title Page (E3 Section 1)",
        "keywords": ["clinical study report", "report title", "study report", "final report", "report number"],
        "weight": 5,
    },
    "synopsis": {
        "label": "Synopsis (E3 Section 2)",
        "keywords": ["synopsis", "summary of clinical study", "study synopsis"],
        "weight": 8,
    },
    "table_of_contents": {
        "label": "Table of Contents (E3 Section 3)",
        "keywords": ["table of contents", "contents", "list of tables", "list of figures"],
        "weight": 3,
    },
    "abbreviations": {
        "label": "List of Abbreviations (E3 Section 4)",
        "keywords": ["abbreviation", "glossary", "definition of terms"],
        "weight": 3,
    },
    "ethics": {
        "label": "Ethics (E3 Section 5)",
        "keywords": ["ethics committee", "irb", "institutional review board", "ethical conduct", "informed consent", "iec"],
        "weight": 8,
    },
    "investigators_and_sites": {
        "label": "Investigators & Study Sites (E3 Section 6)",
        "keywords": ["investigator", "study site", "study center", "principal investigator", "participating site", "administrative structure"],
        "weight": 5,
    },
    "introduction": {
        "label": "Introduction (E3 Section 7)",
        "keywords": ["introduction", "background", "rationale", "disease", "therapeutic area"],
        "weight": 5,
    },
    "study_objectives": {
        "label": "Study Objectives (E3 Section 8)",
        "keywords": ["objective", "primary objective", "secondary objective", "aim of the study"],
        "weight": 8,
    },
    "investigational_plan": {
        "label": "Investigational Plan (E3 Section 9)",
        "keywords": ["study design", "randomized", "double-blind", "open-label", "treatment period", "study plan", "selection of patients", "treatment", "efficacy variable", "safety variable", "statistical method", "sample size"],
        "weight": 12,
    },
    "study_patients": {
        "label": "Study Patients (E3 Section 10)",
        "keywords": ["patient disposition", "subject disposition", "enrolled", "randomized patients", "intent to treat", "demographics", "baseline characteristics", "protocol deviation"],
        "weight": 10,
    },
    "efficacy_results": {
        "label": "Efficacy Evaluation (E3 Section 11)",
        "keywords": ["efficacy analysis", "efficacy results", "primary efficacy", "primary endpoint result", "efficacy evaluation", "responder analysis"],
        "weight": 12,
    },
    "safety_results": {
        "label": "Safety Evaluation (E3 Section 12)",
        "keywords": ["safety analysis", "safety results", "adverse event", "serious adverse event", "safety summary", "safety evaluation", "deaths", "laboratory findings", "vital signs"],
        "weight": 12,
    },
    "discussion_conclusions": {
        "label": "Discussion & Overall Conclusions (E3 Section 13)",
        "keywords": ["discussion", "interpretation", "clinical significance", "benefit-risk", "conclusion", "overall conclusion"],
        "weight": 8,
    },
    "tables_figures_graphs": {
        "label": "Tables, Figures, Graphs (E3 Section 14)",
        "keywords": ["table", "figure", "graph", "listing", "kaplan-meier", "forest plot"],
        "weight": 4,
    },
    "reference_list": {
        "label": "Reference List (E3 Section 15)",
        "keywords": ["reference", "bibliography", "literature"],
        "weight": 3,
    },
    "appendices": {
        "label": "Appendices (E3 Section 16)",
        "keywords": ["appendix", "appendices", "case report form", "protocol and amendments", "patient data listings"],
        "weight": 4,
    },
}

# ICH-GCP E6(R2) Section 4.8.10 — All Required Elements of Informed Consent
# Expanded to cover the full 20-element checklist.
ICH_GCP_48_CONSENT_SECTIONS = {
    "study_is_research": {
        "label": "Statement that study involves research (4.8.10a)",
        "keywords": ["research study", "clinical study", "clinical trial", "research involving"],
        "weight": 8,
    },
    "study_purpose": {
        "label": "Purpose of the trial (4.8.10b)",
        "keywords": ["purpose of the study", "study purpose", "aim of this study", "objective of this research"],
        "weight": 10,
    },
    "treatments_and_randomization": {
        "label": "Trial treatments & probability of assignment (4.8.10c)",
        "keywords": ["treatment", "assigned", "randomiz", "placebo", "chance", "probability", "group"],
        "weight": 9,
    },
    "procedures": {
        "label": "Study procedures (4.8.10d)",
        "keywords": ["procedure", "what will happen", "study visit", "blood sample", "examination", "test"],
        "weight": 10,
    },
    "responsibilities": {
        "label": "Subject's responsibilities (4.8.10e)",
        "keywords": ["responsibilit", "expected to", "must follow", "comply", "asked to"],
        "weight": 6,
    },
    "experimental_aspects": {
        "label": "Experimental aspects (4.8.10f)",
        "keywords": ["experimental", "investigational", "not yet approved", "being studied", "new treatment"],
        "weight": 7,
    },
    "risks": {
        "label": "Foreseeable risks & discomforts (4.8.10g)",
        "keywords": ["risk", "discomfort", "side effect", "adverse", "danger", "harm", "toxicity"],
        "weight": 10,
    },
    "benefits": {
        "label": "Expected benefits (4.8.10h)",
        "keywords": ["benefit", "advantage", "may help", "potential benefit", "no direct benefit"],
        "weight": 8,
    },
    "alternatives": {
        "label": "Alternative procedures / treatments (4.8.10i)",
        "keywords": ["alternative", "other option", "other treatment", "instead of", "standard of care"],
        "weight": 7,
    },
    "compensation_for_injury": {
        "label": "Compensation for injury (4.8.10j)",
        "keywords": ["compensat", "injury", "treatment for injury", "medical care", "harm during"],
        "weight": 7,
    },
    "payment_proration": {
        "label": "Payment & proration (4.8.10k)",
        "keywords": ["payment", "reimburse", "financial", "stipend", "pro-rated", "cost"],
        "weight": 6,
    },
    "expenses": {
        "label": "Anticipated expenses (4.8.10l)",
        "keywords": ["expense", "cost to you", "no charge", "additional cost", "travel"],
        "weight": 5,
    },
    "voluntary_participation": {
        "label": "Voluntary participation & withdrawal (4.8.10m)",
        "keywords": ["voluntary", "free to", "choose to", "right to refuse", "no penalty", "withdraw"],
        "weight": 10,
    },
    "monitor_auditor_access": {
        "label": "Access by monitors / auditors / IRBs (4.8.10n)",
        "keywords": ["monitor", "auditor", "irb", "review board", "access to records", "inspect"],
        "weight": 6,
    },
    "confidentiality": {
        "label": "Confidentiality of records (4.8.10o)",
        "keywords": ["confidential", "privacy", "personal information", "data protection", "hipaa", "identif"],
        "weight": 8,
    },
    "new_information": {
        "label": "New information notification (4.8.10p)",
        "keywords": ["new information", "new finding", "updated information", "will be informed", "may affect"],
        "weight": 7,
    },
    "contact_for_questions": {
        "label": "Contact persons for questions (4.8.10q)",
        "keywords": ["contact", "telephone", "phone", "email", "call", "question"],
        "weight": 8,
    },
    "contact_for_rights": {
        "label": "Contact for subject rights (4.8.10r)",
        "keywords": ["rights", "irb", "ethics committee", "iec", "institutional review board", "concern"],
        "weight": 7,
    },
    "circumstances_for_termination": {
        "label": "Circumstances for termination (4.8.10s)",
        "keywords": ["terminat", "early end", "discontinue", "removed from study", "investigator may"],
        "weight": 6,
    },
    "duration": {
        "label": "Expected duration of participation (4.8.10t)",
        "keywords": ["duration", "how long", "length of participation", "weeks", "months", "period of", "expected to last"],
        "weight": 7,
    },
    "number_of_subjects": {
        "label": "Approximate number of subjects (4.8.10u)",
        "keywords": ["number of", "approximately", "subjects", "participants will", "people will", "patients in this study"],
        "weight": 5,
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

# Map doc_type → appropriate section checklist
_SECTION_MAP = {
    "protocol": ICH_M11_PROTOCOL_SECTIONS,
    "csr": ICH_E3_CSR_SECTIONS,
    "consent_form": ICH_GCP_48_CONSENT_SECTIONS,
    "clinical_document": GENERIC_CLINICAL_SECTIONS,
}

# Guideline label per doc_type for user-facing messages
_GUIDELINE_LABELS = {
    "protocol": "ICH M11",
    "csr": "ICH E3",
    "consent_form": "ICH-GCP 4.8",
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
            "recommendation": "Primary endpoints must be clearly defined per ICH M11 Section 10 requirements.",
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
