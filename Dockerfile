# ═══════════════════════════════════════════════════════════════════════════
# ClinDoc AI — Production Dockerfile
# Multi-stage build for minimal image size
# ═══════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build dependencies ──────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM python:3.12-slim

# Install Tesseract OCR (needed by pytesseract for scanned PDF fallback)
RUN apt-get update && \
    apt-get install -y --no-install-recommends tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd -r clindoc && useradd -r -g clindoc -d /app -s /sbin/nologin clindoc

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY backend/          backend/
COPY frontend/         frontend/
COPY db/prompts/       db/prompts/
COPY db/sample_docs/   db/sample_docs/
COPY run.py            .
COPY requirements.txt  .
COPY .env              .

# Create writable dirs for runtime data (auth, feedback, user_data)
RUN mkdir -p db/auth db/feedback db/user_data "db/demo doc" && \
    chown -R clindoc:clindoc /app

# Switch to non-root user
USER clindoc

# ── Environment defaults (override at deploy time) ───────────────────────
# NOTE: LLM_API_KEY and LLM_GATEWAY_URL are loaded from .env by python-dotenv.
# Do NOT set them here — ENV overrides dotenv and would blank them out.
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DEMO_MODE=true \
    LLM_MODEL=gpt-4.1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Health check for cloud orchestrators (ECS, ACA, K8s, Cloud Run, etc.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')" || exit 1

# Start the app
CMD ["python", "run.py"]
