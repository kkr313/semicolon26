"""
Authentication Manager — Local user auth with hashed passwords.
Stores users in auth/users.json. No external dependencies needed.
"""

import hashlib
import json
import os
import secrets
from datetime import datetime
from pathlib import Path

AUTH_DIR = Path(__file__).parent.parent.parent / "db" / "auth"
USERS_FILE = AUTH_DIR / "users.json"


def _ensure_dir():
    AUTH_DIR.mkdir(exist_ok=True)


def _hash_password(password: str, salt: str = None) -> tuple[str, str]:
    """Hash password with salt using SHA-256. Returns (hash, salt)."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return hashed, salt


def _load_users() -> list[dict]:
    """Load all users from file."""
    _ensure_dir()
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _save_users(users: list[dict]):
    """Save users list to file."""
    _ensure_dir()
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def register_user(name: str, email: str, password: str, role: str) -> dict:
    """
    Register a new user.

    Args:
        name: Display name
        email: Email (used as username)
        password: Plain text password (will be hashed)
        role: "analyst" or "admin"

    Returns:
        {"success": True, "user": {...}} or {"success": False, "error": "..."}
    """
    email = email.strip().lower()
    if not email or not password or not name:
        return {"success": False, "error": "All fields are required."}

    if len(password) < 4:
        return {"success": False, "error": "Password must be at least 4 characters."}


    users = _load_users()

    # Check if email already exists
    if any(u["email"] == email for u in users):
        return {"success": False, "error": "An account with this email already exists."}

    # Hash password
    pw_hash, salt = _hash_password(password)

    user = {
        "id": secrets.token_hex(8),
        "name": name,
        "email": email,
        "password_hash": pw_hash,
        "salt": salt,
        "role": "user",
        "team": "Clinical Operations",
        "created_at": datetime.now().isoformat(),
    }

    users.append(user)
    _save_users(users)

    # Return user without sensitive fields
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "salt")}
    return {"success": True, "user": safe_user}


def login_user(email: str, password: str) -> dict:
    """
    Authenticate a user.

    Returns:
        {"success": True, "user": {...}} or {"success": False, "error": "..."}
    """
    email = email.strip().lower()
    users = _load_users()

    user = next((u for u in users if u["email"] == email), None)
    if user is None:
        return {"success": False, "error": "Invalid email or password."}

    pw_hash, _ = _hash_password(password, user["salt"])
    if pw_hash != user["password_hash"]:
        return {"success": False, "error": "Invalid email or password."}

    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "salt")}
    return {"success": True, "user": safe_user}


def get_all_users() -> list[dict]:
    """Get all users (without passwords)."""
    users = _load_users()
    return [{k: v for k, v in u.items() if k not in ("password_hash", "salt")} for u in users]


def seed_default_admin():
    """Create default demo accounts if no users exist."""
    users = _load_users()
    if not users:
        register_user(
            name="Demo User",
            email="demo@optum.com",
            password="demo123",
            role="user",
        )
