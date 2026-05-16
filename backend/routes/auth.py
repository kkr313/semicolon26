"""
Auth Routes — Login, Register, User list.
"""

from fastapi import APIRouter, HTTPException, Form

from backend.services.auth_manager import register_user, login_user, get_all_users

router = APIRouter()


@router.post("/login")
async def login(email: str = Form(...), password: str = Form(...)):
    """Authenticate user with email and password."""
    result = login_user(email, password)
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["error"])
    return {"success": True, "user": result["user"]}


@router.post("/register")
async def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    role: str = Form("user"),
):
    """Register a new user account."""
    result = register_user(name, email, password, role)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "user": result["user"]}


@router.get("/users")
async def list_users():
    """Get all registered users (admin use)."""
    return {"users": get_all_users()}
