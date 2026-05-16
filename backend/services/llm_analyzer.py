"""
LLM Analyzer — Communicates with an OpenAI-compatible gateway to perform:
1. Clinical document summarization
2. Entity extraction (drugs, endpoints, criteria, AEs)
3. Consistency / risk checking
"""

import hashlib
import json
import os
import re
from pathlib import Path

from openai import OpenAI

from backend.config import (
    LLM_GATEWAY_URL, LLM_API_KEY, LLM_MODEL, PROMPTS_DIR,
    LLM_SYSTEM_PROMPT, LLM_TOP_P, LLM_FREQUENCY_PENALTY,
    LLM_PRESENCE_PENALTY, LLM_REQUEST_TIMEOUT, LLM_MAX_INPUT_CHARS,
    LLM_TEMPERATURE_EXTRACTION, LLM_TEMPERATURE_ANALYSIS,
    LLM_TEMPERATURE_SUMMARIZE, LLM_MAX_TOKENS_SHORT, LLM_MAX_TOKENS_MEDIUM,
    LLM_MAX_TOKENS_LONG, LLM_MAX_TOKENS_SUMMARY,
)

GATEWAY_URL = LLM_GATEWAY_URL
API_KEY = LLM_API_KEY

AVAILABLE_MODELS = [
    "gpt-4.1",           # Default — best for clinical analysis & JSON output
    "gpt-4.1-nano",      # Fast fallback, lower cost
    "gpt-4o",            # Strong general-purpose
    "o3-mini",           # Good reasoning, slower
    "anthropic.claude-sonnet-4",
    "gpt-5.1-CIO",
    "gpt-5.2-CIO",
    "amazon.nova-micro-v1:0",
    "gemini-2.5-flash-lite",
    "amazon.nova-2-lite-v1:0",
    "amazon.nova-lite-v1:0",
]

DEFAULT_MODEL = LLM_MODEL

# Initialise the OpenAI client pointing at the gateway
_client = OpenAI(
    base_url=GATEWAY_URL,
    api_key=API_KEY,
    timeout=LLM_REQUEST_TIMEOUT,       # Per-request timeout (seconds)
    max_retries=2,                      # Auto-retry on transient errors
)

# ── Token Tracking ─────────────────────────────────────────────────────────

_token_usage = {
    "total_prompt_tokens": 0,
    "total_completion_tokens": 0,
    "total_tokens": 0,
    "calls": 0,
    "models_used": [],       # Track every model that actually responded
    "fallback_count": 0,     # How many times a fallback model was used
    "cache_hits": 0,
}

# ── LLM Response Cache ─────────────────────────────────────────────────────
# Caches responses keyed by hash(model + prompt) to avoid re-calling LLM
# on the same document. Cleared on each new analysis run via reset_token_usage().
_response_cache: dict[str, str] = {}


def _cache_key(prompt: str, model: str) -> str:
    return hashlib.sha256(f"{model}:{prompt}".encode()).hexdigest()


def get_token_usage() -> dict:
    """Return accumulated token usage stats with model tracking."""
    models = _token_usage.get("models_used", [])
    real_models = [m for m in models if m != "(cached)"]
    return {
        **_token_usage,
        "cache_hits": _token_usage.get("cache_hits", 0),
        "model_used": real_models[0] if real_models else "unknown",
        "all_models_used": real_models,
        "source": "cache" if (not real_models and _token_usage.get("cache_hits", 0) > 0) else "llm",
    }


def reset_token_usage():
    """Reset token counters and cache (call before a new analysis run)."""
    _token_usage["total_prompt_tokens"] = 0
    _token_usage["total_completion_tokens"] = 0
    _token_usage["total_tokens"] = 0
    _token_usage["calls"] = 0
    _token_usage["cache_hits"] = 0
    _token_usage["models_used"] = []
    _token_usage["fallback_count"] = 0
    _response_cache.clear()


def check_api_status() -> dict:
    """Check if the LLM gateway is reachable and return available models."""
    try:
        # Quick health-check: try a tiny completion
        _client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=5,
        )
        return {"online": True, "models": AVAILABLE_MODELS}
    except Exception as e:
        return {"online": False, "models": [], "error": str(e)}


def call_llm(
    prompt: str,
    model: str = DEFAULT_MODEL,
    temperature: float = LLM_TEMPERATURE_ANALYSIS,
    max_tokens: int = LLM_MAX_TOKENS_LONG,
    system_prompt: str | None = None,
    top_p: float = LLM_TOP_P,
    frequency_penalty: float = LLM_FREQUENCY_PENALTY,
    presence_penalty: float = LLM_PRESENCE_PENALTY,
    response_format: str | None = None,
) -> str:
    """
    Send a prompt to the LLM gateway with best-practice defaults.

    Best practices applied:
    - System prompt: sets a consistent clinical-expert persona
    - Temperature: tuned per task type (0.0 extraction, 0.15 analysis, 0.2 summary)
    - Top-p (nucleus sampling): 0.95 for focused but not repetitive output
    - Frequency/presence penalty: prevents response repetition loops
    - Input truncation: auto-trims prompt to stay within context window
    - Caching: SHA-256 keyed by model+prompt to avoid redundant calls
    - Fallback chain: tries multiple models on failure
    - Timeout: per-request timeout configured at client level
    - Max retries: auto-retries on transient network errors
    """
    # ── Input truncation — keep prompt within context window ──────────────
    if len(prompt) > LLM_MAX_INPUT_CHARS:
        prompt = prompt[:LLM_MAX_INPUT_CHARS] + "\n\n[...truncated for context limit...]"

    # ── Check cache first ────────────────────────────────────────────────
    key = _cache_key(prompt, model)
    if key in _response_cache:
        _token_usage["cache_hits"] = _token_usage.get("cache_hits", 0) + 1
        if "(cached)" not in _token_usage.get("models_used", []):
            _token_usage.setdefault("models_used", []).append("(cached)")
        return _response_cache[key]

    # ── Build messages with system prompt ────────────────────────────────
    sys_prompt = system_prompt or LLM_SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": prompt},
    ]

    # ── Fallback chain ───────────────────────────────────────────────────
    fallback_models = [model, "gpt-4.1", "gpt-4.1-nano", "gpt-4o", "o3-mini", "gemini-2.5-flash-lite"]
    seen = set()
    models_to_try = []
    for m in fallback_models:
        if m not in seen:
            seen.add(m)
            models_to_try.append(m)

    # Models known to support OpenAI-specific params (json mode, penalties)
    _OPENAI_COMPATIBLE = {"gpt-4.1", "gpt-4.1-nano", "gpt-4o", "gpt-5.1-CIO", "gpt-5.2-CIO"}

    last_error = None
    for attempt_model in models_to_try:
        try:
            # ── Build API params with best-practice defaults ────────────
            api_params = {
                "model": attempt_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            # Only pass OpenAI-specific params to compatible models.
            # Non-OpenAI models (Gemini, Nova, etc.) may reject these.
            if attempt_model in _OPENAI_COMPATIBLE or attempt_model.startswith("gpt"):
                api_params["top_p"] = top_p
                api_params["frequency_penalty"] = frequency_penalty
                api_params["presence_penalty"] = presence_penalty
                # JSON mode — ensures well-formed output for parsing tasks
                if response_format == "json":
                    api_params["response_format"] = {"type": "json_object"}

            response = _client.chat.completions.create(**api_params)
            # Track token usage
            if response.usage:
                _token_usage["total_prompt_tokens"] += response.usage.prompt_tokens or 0
                _token_usage["total_completion_tokens"] += response.usage.completion_tokens or 0
                _token_usage["total_tokens"] += response.usage.total_tokens or 0
            _token_usage["calls"] += 1
            # Track which model actually responded
            if attempt_model not in _token_usage.get("models_used", []):
                _token_usage.setdefault("models_used", []).append(attempt_model)
            if attempt_model != model:
                _token_usage["fallback_count"] = _token_usage.get("fallback_count", 0) + 1
            result = response.choices[0].message.content.strip()
            _response_cache[key] = result
            return result
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(f"All models failed. Last error: {last_error}")


def _load_prompt(name: str) -> str:
    """Load a prompt template from the prompts/ directory."""
    path = PROMPTS_DIR / f"{name}.txt"
    return path.read_text(encoding="utf-8")


# ── Summarization ──────────────────────────────────────────────────────────


def summarize_document(chunks: list[dict], model: str = DEFAULT_MODEL, progress_callback=None) -> str:
    """
    Summarize a clinical document using map-reduce:
    1. Summarize each chunk individually
    2. Merge chunk summaries into a final summary
    """
    template = _load_prompt("summarize")
    chunk_summaries = []

    for i, chunk in enumerate(chunks):
        prompt = template.replace("{chunk}", chunk["text"])
        summary = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_SUMMARIZE,
            max_tokens=LLM_MAX_TOKENS_MEDIUM,
            system_prompt="You are a clinical document summarizer. Produce concise, accurate section summaries. Never invent data.",
        )
        chunk_summaries.append(f"[Section: {chunk['section']}]\n{summary}")
        if progress_callback:
            progress_callback(i + 1, len(chunks), "Summarizing")

    if len(chunk_summaries) == 1:
        return chunk_summaries[0]

    # Merge step — combine chunk summaries into one coherent summary
    merge_prompt = (
        "Merge these section summaries into ONE coherent clinical summary. "
        "Structure: Study Overview, Objectives, Study Design, Patient Population, "
        "Endpoints, Key Findings, Safety Profile, Critical Observations. "
        "Remove duplicates. Keep under 800 words.\n\n"
        + "\n\n---\n\n".join(chunk_summaries)
    )
    final = call_llm(
        merge_prompt, model=model,
        temperature=LLM_TEMPERATURE_SUMMARIZE,
        max_tokens=LLM_MAX_TOKENS_SUMMARY,
        system_prompt="You are a clinical document summarizer. Merge section summaries into a coherent final summary. Never invent data.",
    )
    if progress_callback:
        progress_callback(len(chunks), len(chunks), "Merging summaries")
    return final


# ── Entity Extraction ──────────────────────────────────────────────────────


def extract_entities(chunks: list[dict], model: str = DEFAULT_MODEL, progress_callback=None) -> dict:
    """
    Extract structured clinical entities from document chunks.
    Returns merged entities across all chunks.
    """
    template = _load_prompt("extract_entities")
    all_entities = _empty_entities()

    for i, chunk in enumerate(chunks):
        prompt = template.replace("{chunk}", chunk["text"])
        raw = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_EXTRACTION,
            max_tokens=LLM_MAX_TOKENS_MEDIUM,
            system_prompt="You are a clinical data extraction engine. Extract structured entities exactly as found in the source text. Return valid JSON only. Never fabricate entities.",
            response_format="json",
        )
        parsed = _parse_json_response(raw)
        if parsed:
            _merge_entities(all_entities, parsed)
        if progress_callback:
            progress_callback(i + 1, len(chunks), "Extracting entities")

    return all_entities


def _empty_entities() -> dict:
    return {
        "drugs": [],
        "primary_endpoints": [],
        "secondary_endpoints": [],
        "exploratory_endpoints": [],
        "inclusion_criteria": [],
        "exclusion_criteria": [],
        "adverse_events": [],
        "study_phase": "Not mentioned",
        "sample_size": "Not mentioned",
        "study_design": "Not mentioned",
        "therapeutic_area": "Not mentioned",
        "sponsor": "Not mentioned",
    }


def _merge_entities(target: dict, source: dict):
    """Merge extracted entities from a chunk into the accumulated result."""
    for key in ["drugs", "adverse_events"]:
        existing_names = {
            item.get("name", item.get("event", "")).lower()
            for item in target.get(key, [])
        }
        for item in source.get(key, []):
            name = item.get("name", item.get("event", "")).lower()
            if name and name not in existing_names:
                target[key].append(item)
                existing_names.add(name)

    for key in [
        "primary_endpoints", "secondary_endpoints", "exploratory_endpoints",
        "inclusion_criteria", "exclusion_criteria",
    ]:
        existing = {v.lower() for v in target.get(key, [])}
        for val in source.get(key, []):
            if isinstance(val, str) and val.lower() not in existing:
                target[key].append(val)
                existing.add(val.lower())

    # Scalar fields — take the first non-empty value
    for key in ["study_phase", "sample_size", "study_design", "therapeutic_area", "sponsor"]:
        src_val = source.get(key, "Not mentioned")
        if src_val and src_val != "Not mentioned" and target.get(key) == "Not mentioned":
            target[key] = src_val


# ── Risk / Consistency Checking ────────────────────────────────────────────


def check_risks(chunks: list[dict], model: str = DEFAULT_MODEL, doc_type: str = "protocol", progress_callback=None) -> dict:
    """
    Run consistency and risk analysis on document chunks.
    Uses doc-type-specific prompt: risk_check_csr for CSRs, risk_check for others.
    Returns aggregated findings. Section coverage is handled
    separately by the rule-based checker (zero LLM cost).
    """
    prompt_name = "risk_check_csr" if doc_type == "csr" else "risk_check_protocol"
    template = _load_prompt(prompt_name)
    all_findings = []

    for i, chunk in enumerate(chunks):
        prompt = template.replace("{chunk}", chunk["text"])
        raw = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_ANALYSIS,
            max_tokens=LLM_MAX_TOKENS_LONG,
            system_prompt="You are a clinical risk reviewer. Identify regulatory gaps, safety concerns, and inconsistencies. Cite specific sections. Return valid JSON.",
            response_format="json",
        )
        parsed = _parse_json_response(raw)
        if parsed:
            findings = parsed.get("findings", [])
            for f in findings:
                f["source_chunk"] = chunk["section"]
            all_findings.extend(findings)

        if progress_callback:
            progress_callback(i + 1, len(chunks), "Checking risks")

    # Deduplicate findings by title similarity
    unique_findings = _deduplicate_findings(all_findings)

    return {
        "findings": unique_findings,
        "ich_gcp_checklist": {},
        "total_findings": len(unique_findings),
        "high_count": sum(1 for f in unique_findings if f.get("severity") == "HIGH"),
        "medium_count": sum(1 for f in unique_findings if f.get("severity") == "MEDIUM"),
        "low_count": sum(1 for f in unique_findings if f.get("severity") == "LOW"),
    }


def _deduplicate_findings(findings: list[dict]) -> list[dict]:
    """Remove near-duplicate findings based on title similarity."""
    seen_titles = set()
    unique = []
    for f in findings:
        title_lower = f.get("title", "").lower().strip()
        # Simple dedup — exact title match
        if title_lower and title_lower not in seen_titles:
            seen_titles.add(title_lower)
            unique.append(f)
    return unique


# ── Consent Form Analysis ──────────────────────────────────────────────────


def analyze_consent_form(chunks: list[dict], model: str = DEFAULT_MODEL, progress_callback=None) -> dict:
    """
    Analyze an informed consent form for ICH-GCP 4.8 compliance.
    Returns consent elements checklist, readability assessment, and findings.
    """
    template = _load_prompt("consent_check")
    all_findings = []
    merged_elements = {}

    for i, chunk in enumerate(chunks):
        prompt = template.replace("{chunk}", chunk["text"])
        raw = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_EXTRACTION,
            max_tokens=LLM_MAX_TOKENS_MEDIUM,
            system_prompt="You are an ICH-GCP 4.8 consent form reviewer. Evaluate each required element for presence and adequacy. Return valid JSON.",
            response_format="json",
        )
        parsed = _parse_json_response(raw)
        if parsed:
            # Merge consent elements — handles {status, evidence} dicts and booleans
            elements = parsed.get("consent_elements", {})
            for key, val in elements.items():
                prev = merged_elements.get(key)
                if isinstance(val, dict):
                    status = val.get("status", "unknown").lower()
                    # Upgrade rule: present > partial > missing > unknown
                    rank = {"present": 3, "partial": 2, "missing": 1, "unknown": 0}
                    new_rank = rank.get(status, 0)
                    old_rank = 0
                    if isinstance(prev, dict):
                        old_rank = rank.get(prev.get("status", "unknown").lower(), 0)
                    elif prev is True:
                        old_rank = 3
                    if new_rank > old_rank:
                        merged_elements[key] = val
                elif val is True:
                    merged_elements[key] = {"status": "present", "evidence": ""}
                elif key not in merged_elements:
                    merged_elements[key] = {"status": "unknown", "evidence": ""}

            findings = parsed.get("findings", [])
            for f in findings:
                f["source_chunk"] = chunk.get("section", "Unknown")
            all_findings.extend(findings)

        if progress_callback:
            progress_callback(i + 1, len(chunks), "Analyzing consent form")

    # Calculate consent completeness based on status field
    required_elements = [
        "study_purpose", "procedures_described", "duration_stated",
        "risks_disclosed", "benefits_described", "alternatives_mentioned",
        "confidentiality_addressed", "voluntary_participation",
        "withdrawal_rights", "compensation_mentioned",
        "contact_information", "irb_information",
    ]
    present_count = 0
    for e in required_elements:
        val = merged_elements.get(e)
        if isinstance(val, dict):
            present_count += 1 if val.get("status", "").lower() == "present" else 0
        elif val is True:
            present_count += 1
    completeness = round(present_count / len(required_elements) * 100, 1)

    return {
        "consent_elements": merged_elements,
        "completeness_score": completeness,
        "findings": all_findings,
        "total_required": len(required_elements),
        "present_count": present_count,
    }


# ── Document Type Detection ────────────────────────────────────────────────


# Friendly labels for document types
_DOC_TYPE_LABELS = {
    "protocol": "Clinical Protocol",
    "csr": "Clinical Study Report",
    "consent_form": "Consent Form",
    "clinical_document": "Clinical Document",
}


def detect_document_type(text: str) -> str:
    """Detect if the document is a protocol, CSR, consent form, or generic clinical doc.

    Uses weighted keyword matching across the full text (up to 10 000 chars).
    Strong signals (document headers/titles) count 3 points; regular keywords
    count 1 point.  A single strong match is enough to classify.
    """
    text_lower = text[:10000].lower()

    # ── Strong signals — typically appear in the title / header ──────────
    consent_strong = [
        "informed consent", "consent form", "consent document",
        "i voluntarily agree", "authorization to participate",
        "i have read and understand", "by signing you agree",
    ]
    protocol_strong = [
        "study protocol", "clinical protocol",
        "protocol title", "investigational plan",
    ]
    csr_strong = [
        "clinical study report", "study report",
        "statistical analysis results", "efficacy analysis",
    ]

    # ── Weak signals — supporting keywords (1 pt each) ──────────────────
    consent_weak = [
        "withdrawal from study", "you are asked to join",
        "voluntary", "risks:", "benefits:", "payment:",
        "you can stop", "sign:", "your information will be protected",
        "participation is voluntary", "right to withdraw",
    ]
    protocol_weak = [
        "study objectives", "inclusion criteria", "exclusion criteria",
        "primary endpoint", "study design", "randomized",
        "sample size", "treatment arms", "dose escalation",
        "eligibility", "investigational product", "study population",
        "statistical methods", "ethics:", "comparator",
    ]
    csr_weak = [
        "safety analysis", "study results", "efficacy results",
        "adverse events", "disposition of patients", "patient listings",
        "appendices:", "synopsis:", "patients:", "enrolled",
        "primary endpoint not met", "primary endpoint met",
        "sae ", "ae rate", "conclusion:", "report date",
        "screened", "randomized", "efficacy:", "safety:",
        "patient demographics", "this report", "results:",
        "investigational plan",
    ]

    def _score(strong_kws, weak_kws):
        s = sum(3 for kw in strong_kws if kw in text_lower)
        s += sum(1 for kw in weak_kws if kw in text_lower)
        return s

    consent_score = _score(consent_strong, consent_weak)
    protocol_score = _score(protocol_strong, protocol_weak)
    csr_score = _score(csr_strong, csr_weak)

    # ── Disambiguation: CSRs naturally reference protocol terms ──────────
    # If a strong CSR header is detected, demote protocol score because
    # keywords like "inclusion criteria", "study design", "sample size"
    # appear in CSRs as background context, not as the primary purpose.
    has_csr_header = any(kw in text_lower for kw in ["clinical study report", "study report"])
    has_protocol_header = any(kw in text_lower for kw in ["study protocol", "clinical protocol", "protocol title"])
    if has_csr_header and not has_protocol_header:
        protocol_score = protocol_score // 2

    # Pick the highest-scoring type; require at least 1 point
    scores = {
        "consent_form": consent_score,
        "protocol": protocol_score,
        "csr": csr_score,
    }
    best = max(scores, key=scores.get)
    if scores[best] >= 1:
        return best
    return "clinical_document"


def get_doc_type_label(doc_type: str) -> str:
    """Return a user-friendly label for the detected document type."""
    return _DOC_TYPE_LABELS.get(doc_type, doc_type)


# ── Helpers ────────────────────────────────────────────────────────────────


def _parse_json_response(text: str) -> dict | None:
    """Extract JSON from LLM response, which may contain surrounding text."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON block within the text
    patterns = [
        re.compile(r"```json\s*(.*?)\s*```", re.DOTALL),
        re.compile(r"```\s*(.*?)\s*```", re.DOTALL),
        re.compile(r"(\{.*\})", re.DOTALL),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                continue
    return None
