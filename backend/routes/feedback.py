"""
Feedback Routes — Submit and retrieve user feedback.
"""

import json

from fastapi import APIRouter, Form

from backend.services.feedback_manager import save_feedback, load_all_feedback, get_feedback_stats
from backend.services.user_session import save_user_feedback

router = APIRouter()


@router.post("/submit")
async def submit_feedback(
    filename: str = Form(...),
    user_role: str = Form(""),
    user_name: str = Form(""),
    user_id: str = Form(""),
    rating: str = Form(...),
    comment: str = Form(""),
    flagged_entities: str = Form("[]"),
    section_feedback: str = Form("{}"),
):
    """Submit feedback for a document analysis."""
    entry = save_feedback(
        filename=filename,
        user_role=user_role,
        rating=rating,
        comment=comment,
        flagged_entities=json.loads(flagged_entities),
        section_feedback=json.loads(section_feedback),
    )
    # Also save to per-user data
    if user_id:
        try:
            save_user_feedback(user_id, filename, rating, comment)
        except Exception:
            pass
    return {"success": True, "entry": entry}


@router.get("/all")
async def get_all():
    """Get all feedback entries."""
    return {"feedback": load_all_feedback()}


@router.get("/stats")
async def stats():
    """Get aggregate feedback statistics."""
    return get_feedback_stats()
