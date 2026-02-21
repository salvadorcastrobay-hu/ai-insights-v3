"""
Build the QA evaluation prompt for assessing extraction quality.
Separated from the extraction prompt to keep concerns decoupled.
"""

from __future__ import annotations

import json

from src.skills.taxonomy import (
    MODULES, PAIN_SUBTYPES, DEAL_FRICTION_SUBTYPES,
    FAQ_SUBTYPES, COMPETITIVE_RELATIONSHIPS, COMPETITORS,
    SEED_FEATURE_NAMES, PRODUCT_GAP_SUBTYPES, COMPETITOR_CATEGORIES,
)


def build_qa_system_prompt() -> str:
    """Build the system prompt for the QA evaluation agent."""
    return """# Instrucciones - QA Evaluator

Eres un auditor experto de calidad para un sistema de extraccion de insights de llamadas de ventas B2B de software HR.

Tu tarea es evaluar la CALIDAD de los insights extraidos por otro modelo, comparandolos con el transcript original.

## Dimensiones de Evaluacion

Evalua cada dimension con un score de 0.0 a 1.0:

1. **Completitud** (completeness): Proporcion de insights reales del transcript que fueron capturados. 1.0 = no se perdio nada importante.
2. **Precision** (precision): Proporcion de insights extraidos que son correctos y realmente estan en el transcript. 1.0 = ninguno inventado.
3. **Clasificacion** (classification): Insights asignados al tipo, subtipo y modulo correcto segun la taxonomia. 1.0 = todos bien clasificados.
4. **Citas** (quotes_accuracy): Las verbatim_quotes son citas reales del transcript. 1.0 = todas las citas son textuales.

## Que Evaluar

Para cada insight extraido, verifica:
- Es un insight real presente en el transcript?
- El tipo (pain, product_gap, competitive_signal, deal_friction, faq) es correcto?
- El subtipo/codigo de taxonomia es el mas apropiado?
- El modulo asignado es correcto?
- La verbatim_quote aparece textualmente en el transcript?
- El summary captura bien la esencia?

Ademas, revisa el transcript buscando:
- Insights que no fueron extraidos (missing)
- Insights que podrian estar mal clasificados
- Codigos de taxonomia que deberian existir pero no existen

## Formato de Respuesta

Responde con un JSON con esta estructura exacta:

```json
{
  "completeness": 0.0,
  "precision": 0.0,
  "classification": 0.0,
  "quotes_accuracy": 0.0,
  "missing_insights": [
    {
      "insight_type": "pain|product_gap|competitive_signal|deal_friction|faq",
      "description": "Descripcion del insight faltante",
      "evidence": "Fragmento del transcript que lo evidencia"
    }
  ],
  "wrong_classifications": [
    {
      "original_summary": "Summary del insight mal clasificado",
      "current_type": "tipo actual",
      "current_subtype": "subtipo actual",
      "suggested_type": "tipo sugerido",
      "suggested_subtype": "subtipo sugerido",
      "reason": "Por que esta mal clasificado"
    }
  ],
  "hallucinations": [
    {
      "summary": "Summary del insight inventado",
      "reason": "Por que es una alucinacion"
    }
  ],
  "taxonomy_suggestions": [
    {
      "category": "pain_subtypes|deal_friction|faq|competitors|modules",
      "suggested_code": "codigo_sugerido",
      "display_name": "Nombre legible",
      "reason": "Por que deberia existir este codigo"
    }
  ],
  "notes": "Observaciones generales sobre la calidad de extraccion"
}
```

Reglas:
- Se conciso en las descripciones
- Solo reporta missing_insights si realmente hay evidencia clara en el transcript
- Solo reporta hallucinations si el insight NO tiene base en el transcript
- Solo sugiere taxonomy additions si hay un patron claro que no encaja en ningun codigo existente
- Si todo esta bien, deja las listas vacias y pon scores altos"""


def build_qa_user_prompt(
    transcript_text: str,
    insights: list[dict],
    taxonomy_summary: str,
) -> str:
    """Build the user prompt with transcript, extracted insights, and taxonomy."""
    # Format insights for display
    insights_formatted = json.dumps(insights, ensure_ascii=False, indent=2)

    return f"""## Taxonomia Disponible (resumen)

{taxonomy_summary}

## Insights Extraidos (a evaluar)

```json
{insights_formatted}
```

## Transcript Original

{transcript_text}"""


def build_taxonomy_summary() -> str:
    """Build a concise taxonomy summary for the QA prompt."""
    lines = []

    # Modules
    lines.append("### Modulos")
    for code, m in MODULES.items():
        lines.append(f"- `{code}`: {m['display_name']} ({m['status']})")

    # Pain subtypes (grouped by theme)
    lines.append("\n### Pain Subtypes (31)")
    by_theme: dict[str, list[tuple[str, dict]]] = {}
    for code, p in PAIN_SUBTYPES.items():
        by_theme.setdefault(p["theme"], []).append((code, p))
    for theme, pains in by_theme.items():
        lines.append(f"**{theme}:**")
        for code, p in pains:
            lines.append(f"- `{code}`: {p['display_name']}")

    # Product gap subtypes
    lines.append("\n### Product Gap Subtypes (5)")
    for code, pg in PRODUCT_GAP_SUBTYPES.items():
        lines.append(f"- `{code}`: {pg['display_name']}")

    # Deal friction
    lines.append("\n### Deal Friction Subtypes")
    for code, d in DEAL_FRICTION_SUBTYPES.items():
        lines.append(f"- `{code}`: {d['display_name']}")

    # FAQ
    lines.append("\n### FAQ Subtypes")
    for code, f in FAQ_SUBTYPES.items():
        lines.append(f"- `{code}`: {f['display_name']}")

    # Competitive relationships
    lines.append("\n### Competitive Relationships")
    for code, c in COMPETITIVE_RELATIONSHIPS.items():
        lines.append(f"- `{code}`: {c['display_name']}")

    # Competitors (grouped by category)
    lines.append("\n### Competidores Conocidos")
    by_category: dict[str, list[str]] = {}
    for name, info in COMPETITORS.items():
        by_category.setdefault(info["category"], []).append(name)
    for cat_code, cat_info in COMPETITOR_CATEGORIES.items():
        entries = by_category.get(cat_code, [])
        if entries:
            lines.append(f"**{cat_info['display_name']}:** {', '.join(sorted(entries))}")

    # Features
    lines.append("\n### Feature Names (seed)")
    for code, f in SEED_FEATURE_NAMES.items():
        lines.append(f"- `{code}`: {f['display_name']}")

    return "\n".join(lines)
