"""
Text Chunker — Splits extracted document text into LLM-sized chunks.
Preserves section headers so the LLM has context about what part of the
document each chunk belongs to.
"""

import re


# Default chunk config tuned for Mistral 7B context window
DEFAULT_CHUNK_SIZE = 3000      # characters (~750 tokens)
DEFAULT_CHUNK_OVERLAP = 400    # overlap to avoid cutting mid-sentence


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[dict]:
    """
    Split document text into chunks, preserving section headers.

    Returns:
        [
            {"chunk_id": 0, "text": "...", "section": "Study Design", "char_start": 0, "char_end": 3000},
            ...
        ]
    """
    if not text or not text.strip():
        return []

    # Detect sections by common clinical document headings or markdown-style headings
    sections = _split_into_sections(text)

    # Merge small adjacent sections to reduce LLM calls
    merged_sections = []
    buffer_title = ""
    buffer_text = ""
    min_chunk = chunk_size // 3  # sections smaller than this get merged

    for section_title, section_text in sections:
        if len(section_text) > chunk_size:
            # Flush buffer first
            if buffer_text:
                merged_sections.append((buffer_title, buffer_text))
                buffer_title = ""
                buffer_text = ""
            merged_sections.append((section_title, section_text))
        elif len(buffer_text) + len(section_text) > chunk_size:
            # Buffer full, flush it
            if buffer_text:
                merged_sections.append((buffer_title, buffer_text))
            buffer_title = section_title
            buffer_text = section_text
        else:
            # Append to buffer
            if not buffer_text:
                buffer_title = section_title
                buffer_text = section_text
            else:
                buffer_title = f"{buffer_title} + {section_title}"
                buffer_text = buffer_text + "\n\n" + section_text

    if buffer_text:
        merged_sections.append((buffer_title, buffer_text))

    chunks = []
    chunk_id = 0

    for section_title, section_text in merged_sections:
        # If section fits in one chunk, keep it whole
        if len(section_text) <= chunk_size:
            chunks.append({
                "chunk_id": chunk_id,
                "text": section_text,
                "section": section_title,
                "char_start": text.find(section_text[:100]),
                "char_end": text.find(section_text[:100]) + len(section_text),
            })
            chunk_id += 1
        else:
            # Split large sections with overlap
            sub_chunks = _split_with_overlap(section_text, chunk_size, overlap)
            for i, sub in enumerate(sub_chunks):
                part_label = f"{section_title} (part {i + 1}/{len(sub_chunks)})"
                pos = text.find(sub[:100])  # approximate position
                chunks.append({
                    "chunk_id": chunk_id,
                    "text": sub,
                    "section": part_label,
                    "char_start": max(pos, 0),
                    "char_end": max(pos, 0) + len(sub),
                })
                chunk_id += 1

    return chunks


def _split_into_sections(text: str) -> list[tuple[str, str]]:
    """
    Split text by detected section headings.
    Handles: numbered sections (1. INTRODUCTION), markdown headings (## Heading),
    and ALL-CAPS headings.
    """
    # Pattern matches common clinical doc section headers
    heading_pattern = re.compile(
        r"^(?:"
        r"#{1,4}\s+.+"                          # Markdown: ## Heading
        r"|\d+(?:\.\d+)*\.\s+[A-Z][A-Z /.&()-]{3,}$"  # Numbered: 1. STUDY OBJECTIVES
        r"|[A-Z][A-Z\s]{4,50}$"                 # ALL CAPS: STUDY DESIGN
        r")",
        re.MULTILINE,
    )

    matches = list(heading_pattern.finditer(text))

    if not matches:
        # No headings found — return entire text as one section
        return [("Full Document", text)]

    sections = []
    for i, match in enumerate(matches):
        title = match.group().strip().lstrip("#").strip()
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if len(section_text) > 20:  # skip tiny fragments
            sections.append((title, section_text))

    # If there's text before the first heading, include it
    if matches and matches[0].start() > 50:
        preamble = text[: matches[0].start()].strip()
        if preamble:
            sections.insert(0, ("Preamble", preamble))

    return sections if sections else [("Full Document", text)]


def _split_with_overlap(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split a long text into overlapping chunks, breaking at sentence boundaries."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks = []
    current = []
    current_len = 0

    for sentence in sentences:
        if current_len + len(sentence) > chunk_size and current:
            chunks.append(" ".join(current))
            # Keep last few sentences for overlap
            overlap_text = ""
            overlap_sentences = []
            for s in reversed(current):
                if len(overlap_text) + len(s) < overlap:
                    overlap_sentences.insert(0, s)
                    overlap_text = " ".join(overlap_sentences)
                else:
                    break
            current = overlap_sentences
            current_len = len(overlap_text)

        current.append(sentence)
        current_len += len(sentence) + 1

    if current:
        chunks.append(" ".join(current))

    return chunks


def get_top_chunks(chunks: list[dict], max_chunks: int = 5) -> list[dict]:
    """
    Select the most important chunks for analysis.
    Prioritizes chunks from key clinical sections.
    """
    priority_keywords = [
        "objective", "endpoint", "design", "safety", "efficacy",
        "result", "conclusion", "adverse", "inclusion", "exclusion",
        "summary", "overview", "introduction", "method",
    ]

    def score(chunk: dict) -> int:
        text_lower = chunk["text"].lower()
        section_lower = chunk["section"].lower()
        s = 0
        for kw in priority_keywords:
            if kw in section_lower:
                s += 3  # section title match is strong signal
            if kw in text_lower[:500]:
                s += 1
        # Prefer earlier chunks (usually more important)
        s -= chunk["chunk_id"] * 0.1
        return s

    ranked = sorted(chunks, key=score, reverse=True)
    return ranked[:max_chunks]
