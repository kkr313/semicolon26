# Smart Clinical Document Analyzer

AI-powered clinical trial document analysis tool that extracts insights, checks compliance, and generates quality reports from PDF, DOCX, and TXT clinical documents.

---

## Features

- **Document Parsing** — Extracts text from PDF (text-based + scanned via OCR), DOCX, and TXT files
- **AI Summarization** — Generates structured clinical summaries using LLM (map-reduce for large docs)
- **Entity Extraction** — Identifies drugs, endpoints, criteria, adverse events, study phase, sponsor, etc.
- **Risk & Consistency Analysis** — LLM-powered detection of contradictions, safety gaps, ambiguous language
- **ICH-GCP E6(R2) Compliance** — Rule-based scoring of protocol completeness against 13 required elements
- **Quality Score** — Overall 0-100 document quality grade (A/B/C/D)
- **PDF & JSON Reports** — Downloadable analysis reports
- **Model Fallback** — Automatic failover across multiple LLM models if one is unavailable

---

## Project Structure

```
semicolon/
├── app.py                      # Streamlit web application (entry point)
├── requirements.txt            # Python dependencies
├── prompts/
│   ├── summarize.txt           # Prompt template for summarization
│   ├── extract_entities.txt    # Prompt template for entity extraction
│   └── risk_check.txt          # Prompt template for risk/consistency analysis
├── sample_docs/
│   └── sample_protocol.txt     # Sample clinical protocol for testing
└── src/
    ├── __init__.py
    ├── document_parser.py      # PDF/DOCX/TXT text extraction
    ├── text_chunker.py         # Splits text into LLM-sized chunks
    ├── llm_analyzer.py         # LLM API calls (summarize, extract, risk check)
    ├── risk_checker.py         # Rule-based ICH-GCP checks + quality scoring
    └── report_generator.py     # PDF and JSON report generation
```

---

## Prerequisites

- **Python 3.10+**

---

## Installation

```bash
# 1. Clone or navigate to the project
cd C:\Optum\semicolon

# 2. Install dependencies
pip install -r requirements.txt
```

### Dependencies

| Package | Purpose |
|---------|---------|
| streamlit | Web UI framework |
| PyMuPDF | PDF text extraction |
| pdfplumber | PDF table extraction |
| python-docx | DOCX parsing |
| pytesseract | OCR for scanned PDFs |
| fpdf2 | PDF report generation |
| openai | LLM API client |
| Pillow | Image processing for OCR |

---

## Configuration

The app connects to an OpenAI-compatible LLM gateway. Configuration is set via environment variables (optional — defaults are built-in):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_GATEWAY_URL` | `https://hub-proxy-service.thankfulfield-16b4d5d6.eastus.azurecontainerapps.io` | LLM API endpoint |
| `LLM_API_KEY` | (built-in) | API key for authentication |
| `LLM_MODEL` | `gpt-4.1-nano` | Default model to use |

### Available Models

| Model | Best For |
|-------|----------|
| `gpt-4.1-nano` | Fast, cheap — good for testing |
| `gpt-4.1` | High quality general purpose |
| `gpt-4o` | Balanced speed/quality |
| `o3-mini` | Reasoning tasks |
| `anthropic.claude-sonnet-4` | Detailed analysis |
| `gemini-2.5-flash-lite` | Fast alternative |
| `amazon.nova-micro-v1:0` | Lightweight |
| `amazon.nova-lite-v1:0` | Budget option |
| `gpt-5.1-CIO` | Advanced |
| `gpt-5.2-CIO` | Advanced |

---

## Running the Application

```bash
# Start the Streamlit app
python -m streamlit run app.py

# Or with custom port
python -m streamlit run app.py --server.port 8502

# Headless mode (no browser auto-open)
python -m streamlit run app.py --server.headless true
```

The app will be available at: **http://localhost:8501**

---

## How to Use

1. **Open** http://localhost:8501 in your browser
2. **Select a model** from the sidebar dropdown (default: `gpt-4.1-nano`)
3. **Upload** a clinical document (PDF, DOCX, or TXT)
4. **Review** the parsed text preview and chunk count
5. **Click** "Run Full Analysis"
6. **View** results: summary, entities, risk findings, ICH-GCP checklist
7. **Download** the PDF or JSON report

---

## Analysis Pipeline

```
Upload Document
      │
      ▼
┌─────────────────┐
│ Document Parser │  ← Extracts text (PyMuPDF / OCR / python-docx)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Text Chunker   │  ← Splits into ~3000-char sections, merges small ones
└────────┬────────┘
         │
         ▼ (3 parallel LLM steps)
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Summarize     │  │ Extract Entities│  │   Risk Check    │
│   (LLM)         │  │   (LLM)         │  │   (LLM)         │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌──────────────────────────────────────────────────────────┐
│              Rule-Based Checks (no LLM)                  │
│  • ICH-GCP section detection                             │
│  • Abbreviation check                                    │
│  • Ambiguous language detection                          │
│  • Entity completeness validation                        │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────┐
│  Quality Score (0-100) + Grade  │
└────────────────────────┬────────┘
                         │
                         ▼
┌───────────────────────────────────┐
│  PDF Report  │  JSON Report       │
└───────────────────────────────────┘
```

---

## Token Usage Estimate

| Document Size | Chunks | LLM Calls | ~Tokens |
|---------------|--------|-----------|---------|
| Sample (8KB) | 3 | ~10 | ~20,000 |
| Small (50KB) | 8-12 | ~30 | ~60,000 |
| Medium (200KB) | 25-35 | ~80 | ~150,000 |
| Large (500KB+) | 50+ | ~150 | ~300,000 |

Steps 4 (rule-based checks) and 5 (quality scoring) use **zero tokens** — pure code logic.

---

## Fallback Mechanism

If the selected model fails (rate limit, timeout, outage), the system automatically retries with:

1. Selected model → 2. `gpt-4.1-nano` → 3. `gpt-4o` → 4. `o3-mini` → 5. `gemini-2.5-flash-lite`

Only raises an error if ALL models fail.

---

## Testing with Sample Data

A sample clinical protocol is included:

```bash
sample_docs/sample_protocol.txt
```

This is a complete Phase III Metformin XR protocol with all ICH-GCP sections. Upload it to verify the full pipeline.

For real-world testing, download clinical documents from:
- **FDA Drugs@FDA** — Medical Reviews / Clinical Reviews (PDF)
- **EMA** — EPAR Public Assessment Reports (PDF)
- **ClinicalTrials.gov** — Protocol attachments

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `streamlit` not recognized | Use `python -m streamlit run app.py` |
| LLM Gateway offline | Check network; fallback models will be tried automatically |
| Unicode PDF error | Fixed — `_safe()` function handles special characters |
| Too many chunks | Fixed — small sections are auto-merged |
| Scanned PDF not readable | Install Tesseract OCR |
| Port 8501 in use | Use `--server.port 8502` |

---

## Tech Stack

- **Frontend**: Streamlit
- **LLM**: OpenAI-compatible API (multi-model gateway)
- **PDF Parsing**: PyMuPDF + pdfplumber + pytesseract
- **Report Gen**: fpdf2
- **Language**: Python 3.12
