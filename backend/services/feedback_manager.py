"""
Feedback Manager — Stores user feedback on analysis results.
Enables clinical operations teams, medical reviewers, and data managers
to validate extracted insights and provide corrections.
"""

import json
import os
from datetime import datetime
from pathlib import Path

FEEDBACK_DIR = Path(__file__).parent.parent.parent / "db" / "feedback"
FEEDBACK_FILE = FEEDBACK_DIR / "feedback_log.json"


def _ensure_dir():
    FEEDBACK_DIR.mkdir(exist_ok=True)


def save_feedback(
    filename: str,
    user_role: str,
    rating: str,
    comment: str,
    flagged_entities: list[dict] = None,
    section_feedback: dict = None,
) -> dict:
    """
    Save user feedback for a document analysis.

    Args:
        filename: The analyzed document name
        user_role: Role of the reviewer (e.g., "Clinical Operations", "Medical Reviewer")
        rating: "positive" or "negative"
        comment: Free-text feedback
        flagged_entities: List of entities flagged as incorrect
        section_feedback: Per-section accuracy ratings

    Returns:
        The saved feedback entry
    """
    _ensure_dir()

    entry = {
        "timestamp": datetime.now().isoformat(),
        "document": filename,
        "user_role": user_role,
        "rating": rating,
        "comment": comment,
        "flagged_entities": flagged_entities or [],
        "section_feedback": section_feedback or {},
    }

    # Load existing feedback
    existing = load_all_feedback()
    existing.append(entry)

    # Save
    FEEDBACK_FILE.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return entry


def load_all_feedback() -> list[dict]:
    """Load all feedback entries."""
    _ensure_dir()
    if FEEDBACK_FILE.exists():
        try:
            return json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def get_feedback_for_document(filename: str) -> list[dict]:
    """Get all feedback entries for a specific document."""
    all_fb = load_all_feedback()
    return [f for f in all_fb if f.get("document") == filename]


def get_feedback_stats() -> dict:
    """Get aggregate feedback statistics."""
    all_fb = load_all_feedback()
    if not all_fb:
        return {"total": 0, "positive": 0, "negative": 0, "documents_reviewed": 0}

    return {
        "total": len(all_fb),
        "positive": sum(1 for f in all_fb if f["rating"] == "positive"),
        "negative": sum(1 for f in all_fb if f["rating"] == "negative"),
        "documents_reviewed": len(set(f["document"] for f in all_fb)),
        "by_role": _count_by_role(all_fb),
    }


def _count_by_role(feedback: list[dict]) -> dict:
    roles = {}
    for f in feedback:
        role = f.get("user_role", "Unknown")
        roles[role] = roles.get(role, 0) + 1
    return roles
