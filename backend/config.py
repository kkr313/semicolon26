"""
Backend Configuration — Centralized settings, paths, and constants.
All runtime values loaded from .env via python-dotenv.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

# Backend directory
BACKEND_DIR = Path(__file__).parent

# Frontend directory
FRONTEND_DIR = ROOT_DIR / "frontend"

# Data directory (db/ at project root)
DB_DIR = ROOT_DIR / "db"
AUTH_DIR = DB_DIR / "auth"
FEEDBACK_DIR = DB_DIR / "feedback"
USER_DATA_DIR = DB_DIR / "user_data"
PROMPTS_DIR = DB_DIR / "prompts"
SAMPLE_DOCS_DIR = DB_DIR / "sample_docs"

# Server settings
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# LLM settings
LLM_GATEWAY_URL = os.getenv(
    "LLM_GATEWAY_URL",
    "https://hub-proxy-service.thankfulfield-16b4d5d6.eastus.azurecontainerapps.io",
)
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-nano")

# App mode
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"

# Supported file extensions
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
