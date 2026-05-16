"""
User Data Routes — Per-user history, stats, and session data.
"""

from fastapi import APIRouter, Form

from backend.services.user_session import get_user_data

router = APIRouter()


@router.get("/history")
async def user_history(user_id: str):
    """Get a user's analysis history and stats."""
    if not user_id:
        return {"error": "user_id is required"}
    data = get_user_data(user_id)
    return {
        "total_analyses": data.get("total_analyses", 0),
        "history": data.get("history", []),
        "feedback": data.get("feedback", []),
    }
