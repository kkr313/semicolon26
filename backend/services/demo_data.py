"""
Demo Mode — Pre-stored dummy results for testing without consuming LLM tokens.
Toggle "Demo Mode" in the sidebar to use these instead of real API calls.
"""

DEMO_SUMMARY = """## Executive Summary

This is a Phase III, randomized, double-blind, placebo-controlled, multicenter clinical trial evaluating the efficacy and safety of Metformin Extended Release (XR) 1000mg in adult patients with Type 2 Diabetes Mellitus (T2DM) inadequately controlled on diet and exercise alone.

**Key Points:**
- **Study Duration:** 24 weeks with a 4-week screening and 2-week washout period
- **Population:** 500 adult patients (18-75 years) with HbA1c 7.0-10.0%
- **Primary Objective:** Demonstrate superior glycemic control (HbA1c reduction) vs. placebo at Week 24
- **Design:** 1:1 randomization with stratification by baseline HbA1c and BMI
- **Safety Monitoring:** Independent Data Safety Monitoring Board (DSMB) with planned interim analysis at Week 12

The trial follows ICH-GCP E6(R2) guidelines and includes comprehensive safety monitoring for lactic acidosis, hepatic events, and cardiovascular outcomes.
"""

DEMO_ENTITIES = {
    "study_phase": "Phase III",
    "study_design": "Randomized, double-blind, placebo-controlled, multicenter",
    "sample_size": "500 patients (250 per arm)",
    "drugs": [
        {"name": "Metformin XR", "dosage": "1000mg once daily", "route": "Oral"},
        {"name": "Placebo", "dosage": "Matching tablet once daily", "route": "Oral"},
    ],
    "primary_endpoints": [
        "Change from baseline in HbA1c at Week 24",
        "Proportion of patients achieving HbA1c < 7.0% at Week 24",
    ],
    "secondary_endpoints": [
        "Change in fasting plasma glucose (FPG) at Week 24",
        "Change in body weight from baseline",
        "Time to rescue medication",
    ],
    "adverse_events": [
        {"event": "Lactic acidosis", "severity": "HIGH", "monitoring": "Serial lactate levels"},
        {"event": "Gastrointestinal disorders", "severity": "MEDIUM", "monitoring": "Patient diary"},
        {"event": "Vitamin B12 deficiency", "severity": "LOW", "monitoring": "Annual serum B12"},
        {"event": "Hypoglycemia", "severity": "MEDIUM", "monitoring": "SMBG + event log"},
    ],
    "inclusion_criteria": [
        "Adults 18-75 years",
        "Diagnosed T2DM (ADA criteria)",
        "HbA1c 7.0-10.0%",
        "BMI 25-40 kg/m2",
        "Stable diet/exercise regimen >= 8 weeks",
    ],
    "exclusion_criteria": [
        "Type 1 diabetes",
        "eGFR < 45 mL/min/1.73m2",
        "History of lactic acidosis",
        "Active liver disease (ALT > 3x ULN)",
        "Pregnancy or lactation",
    ],
    "sponsor": "PharmaCorp International",
    "protocol_number": "PC-DM-2024-003",
}

DEMO_RISK = {
    "findings": [
        {
            "title": "Missing Rescue Medication Criteria",
            "severity": "HIGH",
            "category": "Patient Safety",
            "description": "The protocol does not clearly define the HbA1c threshold or timepoint at which rescue medication should be initiated for patients with inadequate glycemic control.",
            "recommendation": "Define explicit rescue criteria (e.g., HbA1c > 11% at any visit, or confirmed FPG > 270 mg/dL on 2 consecutive visits).",
        },
        {
            "title": "DSMB Charter Not Referenced",
            "severity": "MEDIUM",
            "category": "Oversight & Governance",
            "description": "While an interim analysis is mentioned at Week 12, the DSMB charter and stopping rules are not provided or referenced in the protocol.",
            "recommendation": "Include reference to DSMB charter document with pre-specified stopping boundaries (O'Brien-Fleming or similar).",
        },
        {
            "title": "Concomitant Medication Washout Unclear",
            "severity": "MEDIUM",
            "category": "Study Design",
            "description": "The 2-week washout period may be insufficient for patients previously on sulfonylureas (half-life considerations) or TZDs (prolonged pharmacodynamic effects).",
            "recommendation": "Specify washout periods by drug class: SU >= 4 weeks, TZD >= 8 weeks, DPP4i >= 2 weeks.",
        },
        {
            "title": "Missing Patient Reported Outcomes",
            "severity": "LOW",
            "category": "Endpoints",
            "description": "No validated quality of life instrument (e.g., DTSQ, EQ-5D) is included despite regulatory expectation for patient-centric outcomes.",
            "recommendation": "Consider adding DTSQ (Diabetes Treatment Satisfaction Questionnaire) as an exploratory endpoint.",
        },
    ],
}

DEMO_CONSENT = {
    "completeness_score": 83,
    "present_count": 10,
    "total_required": 12,
    "consent_elements": {
        "study_purpose": True,
        "procedures_described": True,
        "duration_stated": True,
        "risks_disclosed": True,
        "benefits_described": True,
        "alternatives_mentioned": True,
        "confidentiality_addressed": True,
        "voluntary_participation": True,
        "withdrawal_rights": True,
        "compensation_mentioned": False,
        "contact_information": True,
        "irb_information": False,
    },
    "findings": [
        {
            "title": "Missing Compensation Information",
            "severity": "MEDIUM",
            "category": "Consent Compliance",
            "description": "ICH-GCP 4.8.10(n) requires disclosure of compensation and treatment available for trial-related injury. This was not found in the consent form.",
            "recommendation": "Add a section describing compensation for participation and treatment for trial-related injuries.",
        },
        {
            "title": "IRB/IEC Contact Missing",
            "severity": "LOW",
            "category": "Consent Compliance",
            "description": "The consent form should include contact information for the IRB/IEC for questions about patient rights.",
            "recommendation": "Add IRB contact details including phone number and address.",
        },
    ],
}

DEMO_TOKEN_USAGE = {
    "total_tokens": 4826,
    "total_prompt_tokens": 3512,
    "total_completion_tokens": 1314,
    "calls": 3,
    "cache_hits": 0,
}
