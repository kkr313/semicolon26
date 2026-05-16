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
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1")

# ── LLM Best-Practice Defaults ─────────────────────────────────────────────
# Temperature: 0 = deterministic (extraction, classification)
#              0.1-0.2 = low creativity (clinical analysis)
#              0.7+ = creative (not used in clinical context)
LLM_TEMPERATURE_EXTRACTION = float(os.getenv("LLM_TEMP_EXTRACTION", "0.0"))
LLM_TEMPERATURE_ANALYSIS = float(os.getenv("LLM_TEMP_ANALYSIS", "0.15"))
LLM_TEMPERATURE_SUMMARIZE = float(os.getenv("LLM_TEMP_SUMMARIZE", "0.2"))

# Max output tokens per task type
LLM_MAX_TOKENS_SHORT = int(os.getenv("LLM_MAX_TOKENS_SHORT", "512"))    # fix suggestions
LLM_MAX_TOKENS_MEDIUM = int(os.getenv("LLM_MAX_TOKENS_MEDIUM", "1024")) # entity extraction
LLM_MAX_TOKENS_LONG = int(os.getenv("LLM_MAX_TOKENS_LONG", "2048"))     # comparison, risk
LLM_MAX_TOKENS_SUMMARY = int(os.getenv("LLM_MAX_TOKENS_SUMMARY", "1500"))

# Context window management (truncate input to stay within limits)
LLM_MAX_INPUT_CHARS = int(os.getenv("LLM_MAX_INPUT_CHARS", "12000"))     # ~3k tokens

# Request timeout in seconds
LLM_REQUEST_TIMEOUT = int(os.getenv("LLM_REQUEST_TIMEOUT", "60"))

# Top-p (nucleus sampling) — 1.0 = no filtering; lower = more focused
LLM_TOP_P = float(os.getenv("LLM_TOP_P", "0.95"))

# Frequency/presence penalty — discourages repetition
LLM_FREQUENCY_PENALTY = float(os.getenv("LLM_FREQUENCY_PENALTY", "0.0"))
LLM_PRESENCE_PENALTY = float(os.getenv("LLM_PRESENCE_PENALTY", "0.0"))

# System prompt — sets a consistent clinical-expert persona for all calls
LLM_SYSTEM_PROMPT = (
    "You are a senior clinical regulatory expert with deep knowledge of "
    "ICH M11 (protocol structure), ICH E3 (clinical study reports), and "
    "ICH-GCP 4.8 (informed consent). You provide precise, evidence-based "
    "analysis. Always respond in the exact format requested. Never fabricate "
    "data, citations, or regulatory references. If information is missing or "
    "unclear, explicitly say so rather than guessing."
)

# App mode
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"

# Supported file extensions
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
