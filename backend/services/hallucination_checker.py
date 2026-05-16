"""
Hallucination Checker — Validates LLM findings against source text.

Zero LLM cost. Uses fuzzy string matching to verify that:
1. Evidence quotes actually exist in the document
2. Section references correspond to real sections
3. Findings aren't fabricated

Each finding gets a `verified` status:
  - "verified"   — evidence found in source text (high confidence)
  - "partial"    — partial match found (some evidence present)
  - "unverified" — no matching text found (possible hallucination)
"""

import re
from difflib import SequenceMatcher


def verify_findings(findings: list[dict], full_text: str, chunks: list[dict] = None) -> list[dict]:
    """
    Validate each finding's evidence and section_reference against the source text.
    Mutates findings in-place and returns them.
    """
    if not full_text:
        for f in findings:
            f["verified"] = "unverified"
            f["verification_score"] = 0.0
            f["verification_note"] = "No source text available"
        return findings

    # Normalize source text for matching
    source_lower = full_text.lower()
    source_normalized = _normalize(full_text)

    # Build section index from chunks
    section_names = set()
    if chunks:
        for c in chunks:
            sec = c.get("section", "")
            if sec:
                section_names.add(sec.lower().strip())

    for f in findings:
        evidence = f.get("evidence", "")
        section_ref = f.get("section_reference", "")
        description = f.get("description", "")

        scores = []

        # 1. Check evidence quote against source text
        if evidence:
            ev_score = _best_match_score(evidence, full_text)
            scores.append(("evidence", ev_score))

        # 2. Check section reference exists
        if section_ref:
            sec_score = _check_section_reference(section_ref, source_lower, section_names)
            scores.append(("section", sec_score))

        # 3. Check key terms from description exist in source
        if description:
            term_score = _check_key_terms(description, source_lower)
            scores.append(("terms", term_score))

        # Calculate overall verification score
        if not scores:
            overall = 0.0
        else:
            # Weight: evidence strongest, section medium, terms weakest
            weight_map = {"evidence": 0.5, "section": 0.3, "terms": 0.2}
            total_weight = sum(weight_map.get(s[0], 0.1) for s in scores)
            overall = sum(weight_map.get(s[0], 0.1) * s[1] for s in scores) / total_weight

        # Assign status
        if overall >= 0.6:
            f["verified"] = "verified"
        elif overall >= 0.35:
            f["verified"] = "partial"
        else:
            f["verified"] = "unverified"

        f["verification_score"] = round(overall, 2)

        # Add helpful note
        if f["verified"] == "unverified":
            f["verification_note"] = "Evidence not found in source document — may be hallucinated"
        elif f["verified"] == "partial":
            f["verification_note"] = "Partial match — some supporting text found"
        else:
            f["verification_note"] = "Evidence verified against source document"

    return findings


def get_verification_summary(findings: list[dict]) -> dict:
    """Return counts of verified/partial/unverified findings."""
    counts = {"verified": 0, "partial": 0, "unverified": 0, "total": len(findings)}
    for f in findings:
        status = f.get("verified", "unverified")
        if status in counts:
            counts[status] += 1
    counts["trust_score"] = round(
        (counts["verified"] * 1.0 + counts["partial"] * 0.5) / max(counts["total"], 1) * 100
    )
    return counts


def _normalize(text: str) -> str:
    """Lowercase, collapse whitespace."""
    return re.sub(r'\s+', ' ', text.lower().strip())


def _best_match_score(evidence: str, source: str) -> float:
    """
    Find the best fuzzy match of evidence in the source text.
    Uses sliding window with SequenceMatcher for efficiency.
    """
    if not evidence or not source:
        return 0.0

    ev_norm = _normalize(evidence)
    src_norm = _normalize(source)

    # Quick exact substring check first
    if ev_norm in src_norm:
        return 1.0

    # Check significant phrases (4+ word sequences) from evidence
    words = ev_norm.split()
    if len(words) >= 4:
        # Try progressively smaller windows
        for window_size in [len(words), max(4, len(words) // 2), 4]:
            for i in range(len(words) - window_size + 1):
                phrase = ' '.join(words[i:i + window_size])
                if len(phrase) >= 15 and phrase in src_norm:
                    return min(1.0, 0.5 + (window_size / len(words)) * 0.5)

    # Fall back to SequenceMatcher on a window around the best candidate
    # Limit source scanning for performance
    ev_len = len(ev_norm)
    best_ratio = 0.0
    step = max(1, ev_len // 2)

    for i in range(0, max(1, len(src_norm) - ev_len), step):
        window = src_norm[i:i + ev_len + ev_len // 2]
        ratio = SequenceMatcher(None, ev_norm, window).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
        if best_ratio > 0.85:
            break  # Good enough

    return best_ratio


def _check_section_reference(section_ref: str, source_lower: str, section_names: set) -> float:
    """Check if the section reference is real."""
    ref_lower = section_ref.lower().strip()

    # Direct match in source text
    if ref_lower in source_lower:
        return 1.0

    # Match against known section names from chunks
    for name in section_names:
        if ref_lower in name or name in ref_lower:
            return 0.9

    # Check for section number patterns (e.g., "Section 6.2")
    sec_numbers = re.findall(r'section\s*\d+[\.\d]*', ref_lower)
    for num in sec_numbers:
        if num in source_lower:
            return 0.8

    # Check if at least some keywords from the reference appear
    ref_words = set(re.findall(r'\b\w{4,}\b', ref_lower))
    if ref_words:
        found = sum(1 for w in ref_words if w in source_lower)
        return found / len(ref_words) * 0.6

    return 0.0


def _check_key_terms(description: str, source_lower: str) -> float:
    """Check if key medical/clinical terms from description exist in source."""
    # Extract significant words (4+ chars, skip common words)
    stop_words = {
        'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which',
        'their', 'would', 'could', 'should', 'about', 'does', 'also',
        'into', 'more', 'some', 'than', 'when', 'what', 'such', 'only',
        'other', 'each', 'most', 'very', 'between', 'after', 'before',
        'these', 'those', 'being', 'will', 'they', 'there', 'here',
        'protocol', 'document', 'section', 'finding', 'issue', 'missing',
        'clearly', 'define', 'defined', 'described', 'specified', 'mentioned',
    }
    words = set(re.findall(r'\b\w{4,}\b', description.lower()))
    significant = words - stop_words

    if not significant:
        return 0.5  # Neutral — can't check

    found = sum(1 for w in significant if w in source_lower)
    return found / len(significant)
