"""
Cross-Document Comparator — Compares analysis results across multiple
documents to identify patterns, shared gaps, and version differences.

Stores the latest analysis per user in memory and generates comparison
tables when at least 2 documents have been analyzed.
"""

import json
from datetime import datetime
from pathlib import Path
from difflib import SequenceMatcher

from backend.config import USER_DATA_DIR

COMPARISONS_DIR = USER_DATA_DIR / "comparisons"


def _ensure_dir():
    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)


def _user_comparison_file(user_id: str) -> Path:
    return COMPARISONS_DIR / f"{user_id}_docs.json"


def _load_docs(user_id: str) -> list[dict]:
    _ensure_dir()
    fp = _user_comparison_file(user_id)
    if fp.exists():
        try:
            return json.loads(fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return []


def _save_docs(user_id: str, docs: list[dict]):
    _ensure_dir()
    fp = _user_comparison_file(user_id)
    fp.write_text(json.dumps(docs, indent=2, default=str), encoding="utf-8")


def store_analysis_for_comparison(user_id: str, analysis: dict):
    """
    Store a document's analysis results for future comparison.
    Keeps last 5 documents per user.
    """
    docs = _load_docs(user_id)

    entry = {
        "filename": analysis.get("filename", "unknown"),
        "doc_type": analysis.get("doc_type", "unknown"),
        "doc_type_label": analysis.get("doc_type_label", ""),
        "analyzed_at": datetime.now().isoformat(),
        "quality_score": analysis.get("quality", {}).get("score", 0),
        "quality_grade": analysis.get("quality", {}).get("grade", "—"),
        "findings": [
            {
                "title": f.get("title", ""),
                "severity": f.get("severity", "LOW"),
                "category": f.get("category", ""),
                "agent": f.get("agent", ""),
                "verified": f.get("verified", ""),
            }
            for f in analysis.get("risk", {}).get("findings", [])
        ],
        "finding_counts": {
            "total": analysis.get("risk", {}).get("total_findings", 0),
            "high": analysis.get("risk", {}).get("high_count", 0),
            "medium": analysis.get("risk", {}).get("medium_count", 0),
            "low": analysis.get("risk", {}).get("low_count", 0),
        },
        "trust_score": analysis.get("risk", {}).get("verification", {}).get("trust_score", 0),
        "compliance_pct": _calc_compliance(analysis),
        "entities": _extract_key_entities(analysis.get("entities", {})),
    }

    docs.append(entry)
    docs = docs[-5:]  # keep last 5
    _save_docs(user_id, docs)
    return entry


def get_comparison(user_id: str) -> dict | None:
    """
    Generate a comparison table across all stored documents for this user.
    Returns None if fewer than 2 documents available.
    """
    docs = _load_docs(user_id)
    if len(docs) < 2:
        return None

    # Compare latest 2 documents (or all)
    comparison = {
        "document_count": len(docs),
        "documents": [],
        "shared_findings": [],
        "unique_findings": {},
        "trend": {},
    }

    for doc in docs:
        comparison["documents"].append({
            "filename": doc["filename"],
            "doc_type": doc["doc_type_label"] or doc["doc_type"],
            "analyzed_at": doc["analyzed_at"],
            "quality_score": doc["quality_score"],
            "quality_grade": doc["quality_grade"],
            "finding_counts": doc["finding_counts"],
            "trust_score": doc["trust_score"],
            "compliance_pct": doc["compliance_pct"],
        })

    # Find shared findings (same title across docs)
    all_titles_by_doc = {}
    for i, doc in enumerate(docs):
        for f in doc.get("findings", []):
            title = f["title"].lower().strip()
            if title not in all_titles_by_doc:
                all_titles_by_doc[title] = {"finding": f, "docs": []}
            all_titles_by_doc[title]["docs"].append(doc["filename"])

    for title, info in all_titles_by_doc.items():
        if len(info["docs"]) > 1:
            comparison["shared_findings"].append({
                "title": info["finding"]["title"],
                "severity": info["finding"]["severity"],
                "category": info["finding"]["category"],
                "found_in": info["docs"],
                "count": len(info["docs"]),
            })

    # Unique findings per doc (present in only one doc)
    for doc in docs:
        unique = []
        for f in doc.get("findings", []):
            title = f["title"].lower().strip()
            if len(all_titles_by_doc.get(title, {}).get("docs", [])) == 1:
                unique.append(f["title"])
        comparison["unique_findings"][doc["filename"]] = unique

    # Trend: quality improvement / degradation
    if len(docs) >= 2:
        prev = docs[-2]
        curr = docs[-1]
        score_delta = curr["quality_score"] - prev["quality_score"]
        findings_delta = curr["finding_counts"]["total"] - prev["finding_counts"]["total"]
        comparison["trend"] = {
            "quality_delta": score_delta,
            "quality_direction": "improved" if score_delta > 0 else "declined" if score_delta < 0 else "unchanged",
            "findings_delta": findings_delta,
            "findings_direction": "fewer" if findings_delta < 0 else "more" if findings_delta > 0 else "same",
            "previous_doc": prev["filename"],
            "current_doc": curr["filename"],
        }

    return comparison


def clear_comparison_data(user_id: str):
    """Clear stored documents for a user."""
    _ensure_dir()
    fp = _user_comparison_file(user_id)
    if fp.exists():
        fp.unlink()


def _calc_compliance(analysis: dict) -> int:
    coverage = analysis.get("rule", {}).get("section_coverage", {})
    if not coverage:
        return 0
    total = len(coverage)
    present = sum(1 for v in coverage.values() if v.get("present"))
    return round((present / total) * 100) if total else 0


def _extract_key_entities(entities: dict) -> dict:
    """Extract only the most important entities for comparison."""
    return {
        "study_phase": entities.get("study_phase", ""),
        "sample_size": entities.get("sample_size", ""),
        "drugs": [d.get("name", "") for d in entities.get("drugs", []) if isinstance(d, dict)],
        "primary_endpoints": entities.get("primary_endpoints", [])[:2],
    }
