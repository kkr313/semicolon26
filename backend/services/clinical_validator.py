"""
Clinical Content Validator — checks whether a document is related to
clinical / healthcare / pharmaceutical content before running full analysis.

Uses a two-tier keyword system to avoid false positives:
  STRONG keywords — highly specific to clinical/pharma (1 match = clinical)
  WEAK keywords   — generic medical terms that could appear elsewhere (need 5+)
"""

import re

# ── STRONG indicators: very specific to clinical trials / pharma ──────────
# A single match is enough to confirm clinical content.
_STRONG_KEYWORDS = [
    # Clinical document types
    r"\bclinical\s+trial\b", r"\bclinical\s+study\b", r"\bclinical\s+protocol\b",
    r"\binformed\s+consent\b", r"\bconsent\s+form\b",
    r"\bcase\s+report\s+form\b", r"\bCRF\b",
    r"\bclinical\s+study\s+report\b",
    r"\binvestigator.?s?\s+brochure\b",
    # CSR-specific terms
    r"\bstudy\s+report\b", r"\bfinal\s+report\b",
    r"\bsummary\s+of\s+results\b", r"\bsynopsis\b",
    r"\bpatient\s+disposition\b", r"\bsubject\s+disposition\b",
    r"\bstudy\s+completion\b", r"\bsafety\s+analysis\b",
    r"\befficacy\s+analysis\b", r"\bstatistical\s+analysis\s+results\b",
    r"\bdemographic\b", r"\bbaseline\s+characteristics\b",
    # Study design (specific)
    r"\brandomized\b", r"\bplacebo\b", r"\bdouble.?blind\b",
    r"\bopen.?label\b", r"\bcrossover\s+(study|design|trial)\b",
    r"\bphase\s+[I1-4]+[a-b]?\b",
    r"\binclusion\s+criteria\b", r"\bexclusion\s+criteria\b",
    r"\bprimary\s+endpoint\b", r"\bsecondary\s+endpoint\b",
    # Adverse events (very specific)
    r"\badverse\s+event\b", r"\bserious\s+adverse\s+event\b", r"\bSAE\b",
    r"\bconcomitant\s+medication\b",
    # Pharmacology
    r"\bpharmacokinet\b", r"\bpharmacodynam\b",
    r"\bbioavailab\b", r"\bdose.?escalat\b",
    r"\btreatment\s+arm\b", r"\bactive\s+comparator\b",
    r"\binvestigational\s+(product|drug|medicinal)\b",
    # Regulatory (specific to clinical/pharma)
    r"\bICH\b", r"\bGCP\b", r"\bIRB\b",
    r"\b21\s*CFR\b", r"\bIND\b", r"\bNDA\b", r"\bBLA\b",
    r"\bethics\s+committee\b",
    # Outcomes
    r"\bintent.to.treat\b", r"\bITT\b", r"\bper[\s\-]?protocol\b",
    r"\befficacy\b", r"\bsafety\s+profile\b",
    # Bio
    r"\bbiosimilar\b",
]

# ── WEAK indicators: common medical/health words ─────────────────────────
# Can appear in non-clinical docs. Need 5+ together to confirm.
_WEAK_KEYWORDS = [
    r"\bpatient\b", r"\bsubject\b", r"\bparticipant\b",
    r"\btherapy\b", r"\bdosage\b", r"\bdiagnos\b",
    r"\bsymptom\b", r"\bprognos\b",
    r"\bhospital\b", r"\bclinic\b", r"\bphysician\b",
    r"\bnurse\b", r"\bsurgery\b", r"\bsurgical\b",
    r"\bvaccine\b", r"\bantibod\b",
    r"\boncolog\b", r"\bcardio\b", r"\bneurol\b",
    r"\bimmunolog\b", r"\bhematolog\b", r"\bpatholog\b",
    r"\beligibility\b", r"\bendpoint\b", r"\bcohort\b",
    r"\bsynopsis\b", r"\bregulatory\b",
    r"\bFDA\b", r"\bEMA\b", r"\bHIPAA\b",
    r"\bmedical\s+record\b", r"\bEHR\b", r"\bEMR\b",
    r"\bp[\s\-]?value\b", r"\bconfidence\s+interval\b",
    r"\bstatistical\s+significance\b",
    r"\bhalf.?life\b",
]

_STRONG_COMPILED = [re.compile(kw, re.IGNORECASE) for kw in _STRONG_KEYWORDS]
_WEAK_COMPILED = [re.compile(kw, re.IGNORECASE) for kw in _WEAK_KEYWORDS]

_SAMPLE_SIZE = 3000  # Scan first ~500 words — covers title page + intro/synopsis


def is_clinical_document(text: str) -> dict:
    """
    Quick pre-check on a text sample to verify clinical / healthcare content
    BEFORE any LLM calls are made — protects against wasting API tokens on
    non-clinical documents.

    Two-tier scoring to avoid false positives:
      - 1+ STRONG match  → definitely clinical (high confidence)
      - 5+ WEAK matches  → likely clinical (medium confidence)
      - Otherwise         → rejected

    Returns:
        {
            "is_clinical": bool,
            "confidence": str,        # "high", "medium", "low"
            "matched_terms": int,
            "sample_matches": list,
        }
    """
    if not text or len(text.strip()) < 50:
        return {
            "is_clinical": False,
            "confidence": "low",
            "matched_terms": 0,
            "sample_matches": [],
            "message": "Document contains too little text to analyze.",
        }

    # Only scan the first portion — title/headers/intro contain the strongest signals
    sample = text[:_SAMPLE_SIZE]

    strong_matches = []
    for pattern in _STRONG_COMPILED:
        match = pattern.search(sample)
        if match:
            strong_matches.append(match.group())

    weak_matches = []
    for pattern in _WEAK_COMPILED:
        match = pattern.search(sample)
        if match:
            weak_matches.append(match.group())

    all_matches = strong_matches + weak_matches
    count = len(all_matches)

    # Decision logic
    if strong_matches:
        is_clinical = True
        confidence = "high" if len(strong_matches) >= 3 else "medium"
    elif len(weak_matches) >= 3:
        is_clinical = True
        confidence = "medium"
    else:
        is_clinical = False
        confidence = "low"

    result = {
        "is_clinical": is_clinical,
        "confidence": confidence,
        "matched_terms": count,
        "sample_matches": all_matches[:5],
    }

    if not is_clinical:
        result["message"] = (
            "This document does not appear to be a clinical or healthcare document. "
            "Please upload a clinical trial protocol, CSR, consent form, or other medical document."
        )

    return result
