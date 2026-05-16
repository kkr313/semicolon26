"""
User Session Manager — Per-user JSON data tracking.
Stores each user's analysis history (last 5), feedback, and stats.
Files stored in user_data/{user_id}.json
"""

import json
from datetime import datetime
from pathlib import Path

USER_DATA_DIR = Path(__file__).parent.parent.parent / "db" / "user_data"
MAX_HISTORY = 5


def _ensure_dir():
    USER_DATA_DIR.mkdir(exist_ok=True)


def _user_file(user_id: str) -> Path:
    return USER_DATA_DIR / f"{user_id}.json"


def _load_user_data(user_id: str) -> dict:
    """Load a user's session data from file."""
    _ensure_dir()
    fp = _user_file(user_id)
    if fp.exists():
        try:
            return json.loads(fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "user_id": user_id,
        "total_analyses": 0,
        "history": [],
        "feedback": [],
    }


def _save_user_data(user_id: str, data: dict):
    """Save a user's session data to file."""
    _ensure_dir()
    _user_file(user_id).write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_user_data(user_id: str) -> dict:
    """Get user's full session data (history + stats)."""
    return _load_user_data(user_id)


def save_analysis_to_history(user_id: str, analysis_result: dict):
    """
    Save an analysis result to the user's history.
    Keeps only the last MAX_HISTORY entries.
    """
    data = _load_user_data(user_id)
    data["total_analyses"] = data.get("total_analyses", 0) + 1

    entry = {
        "filename": analysis_result.get("filename", "unknown"),
        "analyzed_at": datetime.now().isoformat(),
        "doc_type": analysis_result.get("doc_type", "unknown"),
        "quality_score": analysis_result.get("quality", {}).get("score", 0),
        "quality_grade": analysis_result.get("quality", {}).get("grade", "—"),
        "findings_count": len(analysis_result.get("risk", {}).get("findings", []))
            + len(analysis_result.get("rule", {}).get("rule_findings", [])),
        "compliance_pct": _calc_compliance(analysis_result),
        "demo_mode": analysis_result.get("demo_mode", False),
        "chunks": analysis_result.get("chunks", 0),
    }

    data["history"].append(entry)
    # Keep only last N
    data["history"] = data["history"][-MAX_HISTORY:]

    _save_user_data(user_id, data)
    return entry


def save_user_feedback(user_id: str, filename: str, rating: str, comment: str):
    """Save feedback to the user's data."""
    data = _load_user_data(user_id)

    fb_entry = {
        "filename": filename,
        "rating": rating,
        "comment": comment,
        "submitted_at": datetime.now().isoformat(),
    }

    data["feedback"].append(fb_entry)
    # Keep last 10 feedback entries
    data["feedback"] = data["feedback"][-10:]

    _save_user_data(user_id, data)
    return fb_entry


def _calc_compliance(result: dict) -> int:
    """Calculate compliance percentage from analysis result."""
    coverage = result.get("rule", {}).get("section_coverage", {})
    if not coverage:
        return 0
    total = len(coverage)
    present = sum(1 for info in coverage.values() if info.get("present"))
    return round((present / total) * 100) if total > 0 else 0
