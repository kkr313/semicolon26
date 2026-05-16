"""
Report Generator — Creates downloadable PDF and JSON reports
from the analysis results.
"""

import json
import io
from datetime import datetime

from fpdf import FPDF


def _safe(text: str) -> str:
    """Sanitize text for latin-1 PDF rendering (replace Unicode chars)."""
    replacements = {
        "\u2014": "-",   # em-dash
        "\u2013": "-",   # en-dash
        "\u2018": "'",   # left single quote
        "\u2019": "'",   # right single quote
        "\u201c": '"',   # left double quote
        "\u201d": '"',   # right double quote
        "\u2026": "...", # ellipsis
        "\u2022": "-",   # bullet
        "\u00b7": "-",   # middle dot
        "\u2265": ">=",  # >=
        "\u2264": "<=",  # <=
        "\u00b1": "+/-", # plus-minus
    }
    for char, repl in replacements.items():
        text = text.replace(char, repl)
    return text.encode("latin-1", errors="replace").decode("latin-1")


class ClinicalReportPDF(FPDF):
    """Custom PDF with header/footer for clinical document reports."""

    def __init__(self, doc_name: str):
        super().__init__()
        self.doc_name = doc_name

    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(80, 80, 80)
        self.cell(0, 8, "Smart Clinical Document Analyzer - Report", align="L")
        self.ln(5)
        self.set_draw_color(0, 102, 204)
        self.set_line_width(0.5)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}} | Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}", align="C")

    def section_title(self, title: str):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(0, 70, 140)
        self.ln(4)
        self.cell(0, 10, title)
        self.ln(10)

    def sub_title(self, title: str):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(50, 50, 50)
        self.cell(0, 7, title)
        self.ln(7)

    def body_text(self, text: str):
        self.set_font("Helvetica", "", 9)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, _safe(text))
        self.ln(2)

    def severity_badge(self, severity: str):
        colors = {
            "HIGH": (220, 53, 69),
            "MEDIUM": (255, 165, 0),
            "LOW": (40, 167, 69),
        }
        r, g, b = colors.get(severity, (128, 128, 128))
        self.set_fill_color(r, g, b)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 8)
        w = self.get_string_width(f" {severity} ") + 4
        self.cell(w, 5, f" {severity} ", fill=True)
        self.set_text_color(30, 30, 30)


def generate_pdf_report(
    filename: str,
    summary: str,
    entities: dict,
    risk_results: dict,
    rule_results: dict,
    quality_score: dict,
) -> bytes:
    """
    Generate a comprehensive PDF report from analysis results.
    Returns the PDF content as bytes.
    """
    pdf = ClinicalReportPDF(filename)
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ── Title Page Info ──
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 15, "Clinical Document Analysis Report", align="C")
    pdf.ln(15)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 7, f"Document: {filename}", align="C")
    pdf.ln(7)
    pdf.cell(0, 7, f"Generated: {datetime.now().strftime('%B %d, %Y at %H:%M')}", align="C")
    pdf.ln(7)

    # Quality score badge
    score = quality_score.get("score", 0)
    grade = quality_score.get("grade", "N/A")
    label = quality_score.get("label", "")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 14)
    if score >= 70:
        pdf.set_text_color(40, 167, 69)
    elif score >= 55:
        pdf.set_text_color(255, 165, 0)
    else:
        pdf.set_text_color(220, 53, 69)
    pdf.cell(0, 10, f"Quality Score: {score}/100 ({grade} - {label})", align="C")
    pdf.ln(15)

    # ── 1. Executive Summary ──
    pdf.section_title("1. Executive Summary")
    pdf.body_text(summary[:3000] if summary else "No summary generated.")

    # ── 2. Extracted Entities ──
    pdf.add_page()
    pdf.section_title("2. Extracted Entities")

    # Study Info
    pdf.sub_title("Study Information")
    study_info = [
        ("Phase", entities.get("study_phase", "Not mentioned")),
        ("Design", entities.get("study_design", "Not mentioned")),
        ("Sample Size", entities.get("sample_size", "Not mentioned")),
        ("Therapeutic Area", entities.get("therapeutic_area", "Not mentioned")),
        ("Sponsor", entities.get("sponsor", "Not mentioned")),
    ]
    for label_text, value in study_info:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(45, 6, f"{label_text}:")
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, _safe(str(value)))
        pdf.ln(6)
    pdf.ln(4)

    # Drugs
    if entities.get("drugs"):
        pdf.sub_title("Drugs / Treatments")
        for drug in entities["drugs"]:
            name = drug.get("name", "Unknown")
            dosage = drug.get("dosage", "Not specified")
            route = drug.get("route", "")
            line = f"  - {name} | Dosage: {dosage}"
            if route:
                line += f" | Route: {route}"
            pdf.body_text(line)

    # Endpoints
    for ep_key, ep_label in [
        ("primary_endpoints", "Primary Endpoints"),
        ("secondary_endpoints", "Secondary Endpoints"),
    ]:
        eps = entities.get(ep_key, [])
        if eps:
            pdf.sub_title(ep_label)
            for ep in eps:
                pdf.body_text(f"  - {ep}")

    # Criteria
    for cr_key, cr_label in [
        ("inclusion_criteria", "Inclusion Criteria"),
        ("exclusion_criteria", "Exclusion Criteria"),
    ]:
        items = entities.get(cr_key, [])
        if items:
            pdf.sub_title(cr_label)
            for item in items[:10]:  # Limit to keep report manageable
                pdf.body_text(f"  - {item}")

    # Adverse Events
    aes = entities.get("adverse_events", [])
    if aes:
        pdf.sub_title("Adverse Events")
        for ae in aes:
            event = ae.get("event", "Unknown")
            severity = ae.get("severity", "")
            freq = ae.get("frequency", "")
            line = f"  - {event}"
            if severity:
                line += f" (Severity: {severity})"
            if freq:
                line += f" - Frequency: {freq}"
            pdf.body_text(line)

    # ── 3. Risk Analysis ──
    pdf.add_page()
    pdf.section_title("3. Risk & Consistency Analysis")

    # Score breakdown
    breakdown = quality_score.get("breakdown", {})
    pdf.sub_title("Quality Score Breakdown")
    pdf.body_text(f"  Section Completeness: {breakdown.get('completeness', 0)}/40")
    pdf.body_text(f"  Risk Assessment: {breakdown.get('risk_penalty', 0)}/40")
    pdf.body_text(f"  Base Score: {breakdown.get('base', 0)}/20")
    pdf.ln(3)

    # Findings
    all_findings = risk_results.get("findings", []) + rule_results.get("rule_findings", [])
    if all_findings:
        # Sort by severity
        severity_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        all_findings.sort(key=lambda f: severity_order.get(f.get("severity", "LOW"), 3))

        pdf.sub_title(f"Findings ({len(all_findings)} total)")
        for i, finding in enumerate(all_findings, 1):
            pdf.ln(2)
            pdf.severity_badge(finding.get("severity", "LOW"))
            pdf.set_font("Helvetica", "B", 9)
            title_text = f"  {finding.get('title', 'Untitled')}"
            pdf.cell(0, 5, _safe(title_text))
            pdf.ln(6)
            pdf.body_text(f"  Category: {finding.get('category', 'N/A')}")
            pdf.body_text(f"  {finding.get('description', '')}")
            pdf.body_text(f"  Recommendation: {finding.get('recommendation', 'N/A')}")
            pdf.ln(2)
    else:
        pdf.body_text("No significant findings detected.")

    # ── 4. ICH-GCP Checklist ──
    section_coverage = rule_results.get("section_coverage", {})
    if section_coverage:
        pdf.add_page()
        pdf.section_title("4. ICH-GCP E6(R2) Completeness Checklist")
        pdf.body_text(f"Completeness Score: {rule_results.get('completeness_score', 0)}%")
        pdf.ln(3)

        for section_id, info in section_coverage.items():
            status = "PRESENT" if info["present"] else "MISSING"
            icon = "[+]" if info["present"] else "[-]"
            pdf.set_font("Helvetica", "B" if not info["present"] else "", 9)
            if not info["present"]:
                pdf.set_text_color(220, 53, 69)
            else:
                pdf.set_text_color(40, 167, 69)
            pdf.cell(0, 6, _safe(f"  {icon} {info['label']} - {status}"))
            pdf.set_text_color(30, 30, 30)
            pdf.ln(6)

    # Return PDF bytes
    return bytes(pdf.output())


def generate_json_report(
    filename: str,
    summary: str,
    entities: dict,
    risk_results: dict,
    rule_results: dict,
    quality_score: dict,
) -> str:
    """Generate a JSON report from analysis results."""
    report = {
        "report_metadata": {
            "document": filename,
            "generated_at": datetime.now().isoformat(),
            "tool": "Smart Clinical Document Analyzer v1.0",
        },
        "quality_score": quality_score,
        "summary": summary,
        "entities": entities,
        "risk_analysis": {
            "llm_findings": risk_results.get("findings", []),
            "rule_findings": rule_results.get("rule_findings", []),
            "total_findings": risk_results.get("total_findings", 0) + len(rule_results.get("rule_findings", [])),
        },
        "ich_gcp_completeness": {
            "score": rule_results.get("completeness_score", 0),
            "sections": rule_results.get("section_coverage", {}),
        },
    }
    return json.dumps(report, indent=2, default=str)
