"""
Agent Orchestrator — Multi-agent clinical document review system.

3 specialized agents analyze the document in parallel:
  - Safety Agent: Pharmacovigilance, AE/SAE, safety monitoring
  - Statistics Agent: Methodology, sample size, endpoints, analysis plan
  - Regulatory Agent: ICH-GCP compliance, structure, ethics

The orchestrator merges findings, detects cross-agent agreement,
and assigns confidence scores.
"""

import json
from backend.services.llm_analyzer import call_llm, _load_prompt, _parse_json_response
from backend.config import LLM_TEMPERATURE_ANALYSIS, LLM_MAX_TOKENS_LONG

# Agent-specific system prompts for focused persona
_AGENT_SYSTEM_PROMPTS = {
    "safety": (
        "You are a Pharmacovigilance Reviewer specializing in drug safety. "
        "Focus on adverse events, SAEs, safety monitoring gaps, DSMB procedures, "
        "and risk-benefit assessments. Cite specific regulatory requirements. "
        "Return valid JSON with findings array."
    ),
    "statistics": (
        "You are a senior Biostatistician reviewing clinical trial methodology. "
        "Focus on sample size justification, randomization, blinding, statistical "
        "analysis plans, endpoint definitions, and multiplicity adjustments. "
        "Return valid JSON with findings array."
    ),
    "regulatory": (
        "You are a Regulatory Affairs Specialist reviewing ICH-GCP compliance. "
        "Focus on protocol structure, ethics committee requirements, informed consent, "
        "data integrity, and regulatory submission readiness. "
        "Return valid JSON with findings array."
    ),
}

AGENT_DEFINITIONS = {
    "safety": {
        "prompt_file": "agent_safety",
        "label": "Safety Agent",
        "icon": "shield",
        "color": "red",
        "role": "Pharmacovigilance Reviewer",
    },
    "statistics": {
        "prompt_file": "agent_statistics",
        "label": "Statistics Agent",
        "icon": "chart",
        "color": "blue",
        "role": "Biostatistician",
    },
    "regulatory": {
        "prompt_file": "agent_regulatory",
        "label": "Regulatory Agent",
        "icon": "clipboard",
        "color": "green",
        "role": "Regulatory Affairs Specialist",
    },
}


def run_agent(agent_name: str, chunks: list[dict], model: str = "gpt-4.1") -> dict:
    """
    Run a single agent across all document chunks.
    Returns merged findings with agent attribution.
    """
    agent_def = AGENT_DEFINITIONS[agent_name]
    template = _load_prompt(agent_def["prompt_file"])
    all_findings = []
    confidence_scores = []

    for chunk in chunks:
        prompt = template.replace("{chunk}", chunk["text"])
        raw = call_llm(
            prompt, model=model,
            temperature=LLM_TEMPERATURE_ANALYSIS,
            max_tokens=LLM_MAX_TOKENS_LONG,
            system_prompt=_AGENT_SYSTEM_PROMPTS.get(agent_name),
            response_format="json",
        )
        parsed = _parse_json_response(raw)
        if parsed:
            findings = parsed.get("findings", [])
            conf = parsed.get("confidence", 0.7)
            confidence_scores.append(conf)
            for f in findings:
                f["agent"] = agent_name
                f["agent_label"] = agent_def["label"]
                f["agent_icon"] = agent_def["icon"]
                f["agent_color"] = agent_def["color"]
                f["source_chunk"] = chunk.get("section", "")
            all_findings.extend(findings)

    avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.5

    return {
        "agent": agent_name,
        "label": agent_def["label"],
        "role": agent_def["role"],
        "findings": all_findings,
        "confidence": round(avg_confidence, 2),
        "finding_count": len(all_findings),
    }


def run_all_agents(chunks: list[dict], model: str = "gpt-4.1", doc_type: str = "protocol") -> dict:
    """
    Run all 3 agents sequentially (to manage API cost).
    Merges findings and detects cross-agent agreement.
    """
    agents_to_run = list(AGENT_DEFINITIONS.keys())

    agent_results = {}
    all_findings = []

    for agent_name in agents_to_run:
        result = run_agent(agent_name, chunks, model=model)
        agent_results[agent_name] = result
        all_findings.extend(result["findings"])

    # Cross-agent agreement analysis
    all_findings = _detect_agreement(all_findings)

    # Deduplicate across agents (same title from different agents = agreement, not duplicate)
    unique_findings = _deduplicate_cross_agent(all_findings)

    # Sort: HIGH first, then MEDIUM, then LOW
    sev_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    unique_findings.sort(key=lambda f: sev_order.get(f.get("severity", "LOW").upper(), 3))

    return {
        "findings": unique_findings,
        "agent_results": {
            name: {
                "label": r["label"],
                "role": r["role"],
                "confidence": r["confidence"],
                "finding_count": r["finding_count"],
            }
            for name, r in agent_results.items()
        },
        "total_findings": len(unique_findings),
        "high_count": sum(1 for f in unique_findings if f.get("severity", "").upper() == "HIGH"),
        "medium_count": sum(1 for f in unique_findings if f.get("severity", "").upper() == "MEDIUM"),
        "low_count": sum(1 for f in unique_findings if f.get("severity", "").upper() == "LOW"),
    }


def _detect_agreement(findings: list[dict]) -> list[dict]:
    """
    Check if multiple agents flagged similar issues.
    If so, mark them with agreement info.
    """
    # Group findings by title similarity
    title_groups = {}
    for f in findings:
        key = f.get("title", "").lower().strip()
        if key:
            if key not in title_groups:
                title_groups[key] = []
            title_groups[key].append(f["agent"])

    for f in findings:
        key = f.get("title", "").lower().strip()
        agents_agreeing = title_groups.get(key, [])
        unique_agents = list(set(agents_agreeing))
        f["agents_agree"] = unique_agents
        f["agreement_count"] = len(unique_agents)

    return findings


def _deduplicate_cross_agent(findings: list[dict]) -> list[dict]:
    """
    When multiple agents find the same issue, keep the most detailed one
    but note all agents that found it.
    """
    seen = {}
    for f in findings:
        key = f.get("title", "").lower().strip()
        if not key:
            continue
        if key not in seen:
            seen[key] = f
        else:
            existing = seen[key]
            # Keep the one with more detail
            if len(f.get("description", "")) > len(existing.get("description", "")):
                f["agents_agree"] = existing.get("agents_agree", [])
                seen[key] = f
            # Merge agent agreement lists
            all_agents = set(existing.get("agents_agree", []) + f.get("agents_agree", []))
            seen[key]["agents_agree"] = list(all_agents)
            seen[key]["agreement_count"] = len(all_agents)

    return list(seen.values())
