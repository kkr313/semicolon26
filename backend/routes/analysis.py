"""
Analysis Routes — Document upload, parsing, and AI analysis.
"""

import asyncio
import os
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request

from fastapi.responses import Response

from backend.config import DEMO_MODE as DEFAULT_DEMO_MODE
from backend.services.document_parser import parse_uploaded_file
from backend.services.text_chunker import chunk_text
from backend.services.clinical_validator import is_clinical_document
from backend.services.llm_analyzer import (
    check_api_status,
    summarize_document,
    extract_entities,
    check_risks,
    analyze_consent_form,
    detect_document_type,
    get_doc_type_label,
    AVAILABLE_MODELS,
    get_token_usage,
    reset_token_usage,
)
from backend.services.risk_checker import run_rule_based_checks, calculate_quality_score
from backend.services.demo_data import DEMO_SUMMARY, DEMO_ENTITIES, DEMO_RISK, DEMO_CONSENT, DEMO_TOKEN_USAGE
from backend.services.user_session import save_analysis_to_history
from backend.services.report_generator import generate_pdf_report, generate_json_report

router = APIRouter()


class _UploadedFileAdapter:
    """Adapter to make FastAPI UploadFile compatible with our parser."""

    def __init__(self, path: str, filename: str, content_type: str):
        self.name = filename
        self.type = content_type
        self._path = path

    def read(self):
        with open(self._path, "rb") as f:
            return f.read()

    def getvalue(self):
        return self.read()


@router.get("/status")
async def llm_status():
    """Check if LLM gateway is online and return config defaults."""
    result = check_api_status()
    result["demo_mode"] = DEFAULT_DEMO_MODE
    return result


@router.get("/models")
async def available_models():
    """List available LLM models."""
    return {"models": AVAILABLE_MODELS}


@router.post("/run")
async def analyze_document(
    request: Request,
    file: UploadFile = File(...),
    demo_mode: str = Form(None),
    model: str = Form("gpt-4.1-nano"),
    user_id: str = Form(""),
):
    """
    Upload and analyze a clinical document.
    demo_mode defaults to DEMO_MODE from .env if not explicitly sent.
    """
    # Resolve demo flag: use form value if sent, otherwise fall back to .env config
    if demo_mode is None:
        use_demo = DEFAULT_DEMO_MODE
    else:
        use_demo = demo_mode.lower() == "true"
    # Validate file type
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, DOCX, or TXT.")

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Parse document
        adapter = _UploadedFileAdapter(
            tmp_path, file.filename, file.content_type or "application/octet-stream"
        )
        parsed = parse_uploaded_file(adapter)

        if parsed.get("error"):
            raise HTTPException(status_code=422, detail=parsed["error"])

        # Validate clinical content
        clinical_check = is_clinical_document(parsed["text"])
        if not clinical_check["is_clinical"]:
            raise HTTPException(status_code=422, detail=clinical_check["message"])

        # Chunk text
        chunks = chunk_text(parsed["text"])

        # Detect document type
        doc_type = detect_document_type(parsed["text"])

        # Run analysis (demo or live)
        if use_demo:
            analysis = {
                "summary": DEMO_SUMMARY,
                "entities": DEMO_ENTITIES,
                "risk": DEMO_RISK,
                "token_usage": DEMO_TOKEN_USAGE,
            }
            if doc_type == "consent_form":
                analysis["consent"] = DEMO_CONSENT
        else:
            reset_token_usage()
            loop = asyncio.get_event_loop()
            executor = ThreadPoolExecutor(max_workers=1)

            # Helper: run sync LLM function in thread, check for client disconnect
            async def run_or_cancel(func, *args, **kwargs):
                task = loop.run_in_executor(executor, lambda: func(*args, **kwargs))
                while not task.done():
                    if await request.is_disconnected():
                        task.cancel()
                        raise HTTPException(status_code=499, detail="Client disconnected")
                    await asyncio.sleep(0.5)
                return task.result()

            summary = await run_or_cancel(summarize_document, chunks, model=model)
            entities = await run_or_cancel(extract_entities, chunks, model=model)
            risk = await run_or_cancel(check_risks, chunks, model=model, doc_type=doc_type)

            analysis = {
                "summary": summary,
                "entities": entities,
                "risk": risk,
            }
            if doc_type == "consent_form":
                analysis["consent"] = await run_or_cancel(analyze_consent_form, chunks, model=model)
            analysis["token_usage"] = get_token_usage()

        # Rule-based checks (always run — no LLM needed)
        rule_results = run_rule_based_checks(parsed["text"], analysis["entities"], doc_type=doc_type)
        quality = calculate_quality_score(
            rule_results["completeness_score"],
            analysis["risk"].get("findings", []),
            rule_results.get("rule_findings", []),
        )

        result = {
            "success": True,
            "filename": parsed["filename"],
            "pages": parsed["pages"],
            "method": parsed["method"],
            "chars": len(parsed["text"]),
            "chunks": len(chunks),
            "doc_type": doc_type,
            "doc_type_label": get_doc_type_label(doc_type),
            "demo_mode": use_demo,
            "summary": analysis["summary"],
            "entities": analysis["entities"],
            "risk": analysis["risk"],
            "consent": analysis.get("consent"),
            "rule": rule_results,
            "quality": quality,
            "token_usage": analysis["token_usage"],
        }

        # Save to user history
        if user_id:
            try:
                save_analysis_to_history(user_id, {
                    "filename": parsed["filename"],
                    "doc_type": doc_type,
                    "demo_mode": use_demo,
                    "chunks": len(chunks),
                    "quality": quality,
                    "risk": analysis["risk"],
                    "rule": rule_results,
                })
            except Exception:
                pass  # Don't fail analysis if history save fails

        return result
    finally:
        os.unlink(tmp_path)


@router.post("/download/pdf")
async def download_pdf(
    filename: str = Form(...),
    summary: str = Form(""),
    entities: str = Form("{}"),
    risk: str = Form("{}"),
    rule: str = Form("{}"),
    quality: str = Form("{}"),
):
    """Generate and download a PDF report from analysis results."""
    import json as _json
    pdf_bytes = generate_pdf_report(
        filename=filename,
        summary=summary,
        entities=_json.loads(entities),
        risk_results=_json.loads(risk),
        rule_results=_json.loads(rule),
        quality_score=_json.loads(quality),
    )
    safe_name = Path(filename).stem + "_report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.post("/download/json")
async def download_json(
    filename: str = Form(...),
    summary: str = Form(""),
    entities: str = Form("{}"),
    risk: str = Form("{}"),
    rule: str = Form("{}"),
    quality: str = Form("{}"),
):
    """Generate and download a JSON report from analysis results."""
    import json as _json
    json_str = generate_json_report(
        filename=filename,
        summary=summary,
        entities=_json.loads(entities),
        risk_results=_json.loads(risk),
        rule_results=_json.loads(rule),
        quality_score=_json.loads(quality),
    )
    safe_name = Path(filename).stem + "_report.json"
    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
