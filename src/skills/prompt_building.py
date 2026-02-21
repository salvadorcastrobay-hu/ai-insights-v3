"""
Build the system prompt with the full taxonomy and few-shot examples.
The system prompt is reused across all requests; only the transcript changes.
"""

from __future__ import annotations

import json
import logging
import os

from src.skills.taxonomy import (
    HR_CATEGORIES, MODULES, PAIN_SUBTYPES, DEAL_FRICTION_SUBTYPES,
    FAQ_SUBTYPES, COMPETITIVE_RELATIONSHIPS, COMPETITORS,
    SEED_FEATURE_NAMES, MODULE_ALIASES, INSIGHT_TYPES,
)

logger = logging.getLogger(__name__)

REFINEMENTS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "prompt_refinements.json")


def build_system_prompt() -> str:
    """Build the full system prompt with taxonomy and instructions."""
    sections = [
        _header(),
        _taxonomy_modules(),
        _taxonomy_pains(),
        _taxonomy_deal_friction(),
        _taxonomy_faq(),
        _taxonomy_competitive(),
        _taxonomy_product_gap(),
        _taxonomy_competitors(),
        _output_instructions(),
        _few_shot_examples(),
    ]

    # Load QA refinements if they exist
    refinements_section = _load_refinements()
    if refinements_section:
        sections.append(refinements_section)

    return "\n\n".join(sections)


def build_user_prompt(transcript_text: str, metadata: dict) -> str:
    """Build the user prompt with CRM context and transcript."""
    context_parts = []
    field_map = {
        "deal_name": "Deal",
        "company_name": "Empresa",
        "region": "Region",
        "country": "Pais",
        "industry": "Industria",
        "company_size": "Tamano",
        "deal_stage": "Etapa",
        "deal_owner": "Owner",
        "call_date": "Fecha",
    }
    for field, label in field_map.items():
        val = metadata.get(field)
        if val:
            context_parts.append(f"- {label}: {val}")

    context_str = "\n".join(context_parts) if context_parts else "- Sin contexto CRM disponible"

    return f"""## Contexto del Deal

{context_str}

## Transcript

{transcript_text}"""


# ── Private builders ──

def _header() -> str:
    return """# Instrucciones

Eres un analista experto en ventas B2B de software HR. Tu tarea es extraer insights estructurados de transcripts de llamadas de ventas.

Analiza el transcript y extrae TODOS los insights que encuentres. Cada insight debe clasificarse en exactamente UNO de estos tipos:

| Tipo | Codigo | Cuando usarlo |
|------|--------|--------------|
| Dolor / Problema | `pain` | El prospecto describe un problema, frustración o necesidad actual |
| Feature Faltante | `product_gap` | El prospecto pide una funcionalidad que no existe o no es suficiente |
| Señal Competitiva | `competitive_signal` | Se menciona un competidor (lo usan, evalúan, comparan, migran) |
| Fricción del Deal | `deal_friction` | Algo que frena o bloquea el avance de la venta |
| Pregunta Frecuente | `faq` | El prospecto hace una pregunta sobre el producto/servicio |

Reglas importantes:
1. Usa SOLO los códigos de la taxonomía que se lista abajo
2. Para `product_gap`, SIEMPRE asigna un módulo
3. Para `pain`, asigna módulo si el dolor está claramente relacionado a uno
4. Para `competitive_signal`, normaliza el nombre del competidor al de la lista
5. Si un feature no está en la seed list, crea un código nuevo en formato slug (lowercase, underscores)
6. Cada insight debe tener un `summary` en español, conciso (1-2 oraciones)
7. Incluye `verbatim_quote` siempre que sea posible (cita textual del transcript)
8. El campo `confidence` va de 0 a 1 (1 = certeza total, 0.5 = inferido del contexto)
9. NO inventes insights que no estén en el transcript
10. Si no hay insights de algún tipo, simplemente no los incluyas"""


def _taxonomy_modules() -> str:
    lines = ["# Taxonomía: Módulos HR\n"]
    lines.append("| Código Módulo | Display Name | Categoría HR | Status |")
    lines.append("|---|---|---|---|")
    for code, m in MODULES.items():
        cat_display = HR_CATEGORIES[m["hr_category"]]["display_name"]
        lines.append(f"| `{code}` | {m['display_name']} | {cat_display} | {m['status']} |")

    # Add aliases section
    lines.append("\n## Aliases de Módulos (para reconocer menciones)")
    lines.append("Cuando el prospecto mencione cualquiera de estos términos, mapéalo al módulo correspondiente:\n")

    # Group aliases by module
    aliases_by_module: dict[str, list[str]] = {}
    for alias, module_code in MODULE_ALIASES.items():
        aliases_by_module.setdefault(module_code, []).append(alias)

    for module_code, aliases in sorted(aliases_by_module.items()):
        display = MODULES[module_code]["display_name"]
        lines.append(f"- **{display}** (`{module_code}`): {', '.join(aliases)}")

    return "\n".join(lines)


def _taxonomy_pains() -> str:
    lines = ["# Taxonomía: Pain Subtypes\n"]

    # General pains
    lines.append("## Pains Generales (no vinculados a módulo)")
    lines.append("| Código | Display Name | Theme |")
    lines.append("|---|---|---|")
    for code, p in PAIN_SUBTYPES.items():
        if p["module"] is None:
            lines.append(f"| `{code}` | {p['display_name']} | {p['theme']} |")

    # Module-linked pains
    lines.append("\n## Pains Vinculados a Módulo")
    lines.append("| Código | Display Name | Módulo | Theme |")
    lines.append("|---|---|---|---|")
    for code, p in PAIN_SUBTYPES.items():
        if p["module"] is not None:
            mod_display = MODULES.get(p["module"], {}).get("display_name", p["module"])
            lines.append(f"| `{code}` | {p['display_name']} | {mod_display} (`{p['module']}`) | {p['theme']} |")

    return "\n".join(lines)


def _taxonomy_deal_friction() -> str:
    lines = ["# Taxonomía: Deal Friction Subtypes\n"]
    lines.append("| Código | Display Name |")
    lines.append("|---|---|")
    for code, d in DEAL_FRICTION_SUBTYPES.items():
        lines.append(f"| `{code}` | {d['display_name']} |")
    return "\n".join(lines)


def _taxonomy_faq() -> str:
    lines = ["# Taxonomía: FAQ Subtypes\n"]
    lines.append("| Código | Display Name |")
    lines.append("|---|---|")
    for code, f in FAQ_SUBTYPES.items():
        lines.append(f"| `{code}` | {f['display_name']} |")
    return "\n".join(lines)


def _taxonomy_competitive() -> str:
    lines = ["# Taxonomía: Competitive Relationships\n"]
    lines.append("| Código | Display Name | Cuándo usarlo |")
    lines.append("|---|---|---|")
    for code, c in COMPETITIVE_RELATIONSHIPS.items():
        lines.append(f"| `{code}` | {c['display_name']} | {c['description']} |")
    return "\n".join(lines)


def _taxonomy_product_gap() -> str:
    lines = ["# Taxonomía: Product Gap - Feature Names (seed list)\n"]
    lines.append("Usa estos códigos cuando apliquen. Si la feature no está en la lista, crea un código nuevo en formato slug.\n")
    lines.append("| Código | Display Name | Módulo Sugerido |")
    lines.append("|---|---|---|")
    for code, f in SEED_FEATURE_NAMES.items():
        mod = f.get("suggested_module") or "—"
        lines.append(f"| `{code}` | {f['display_name']} | {mod} |")
    lines.append("\n**gap_priority:** `must_have` (lo necesitan sí o sí), `nice_to_have` (sería bueno tenerlo), `dealbreaker` (sin esto no compran)")
    return "\n".join(lines)


def _taxonomy_competitors() -> str:
    lines = ["# Competidores Conocidos\n"]
    lines.append("Normaliza el nombre del competidor al de esta lista. Si no está, usa el nombre tal como lo menciona el prospecto.\n")

    by_region: dict[str, list[str]] = {}
    for name, region in COMPETITORS.items():
        by_region.setdefault(region, []).append(name)

    for region, names in sorted(by_region.items()):
        label = region.upper().replace("_", " ")
        lines.append(f"**{label}:** {', '.join(sorted(names))}")

    return "\n".join(lines)


def _output_instructions() -> str:
    return """# Formato de Salida

Responde con un JSON que contenga una lista de insights. Cada insight tiene estos campos:

```
{
  "insights": [
    {
      "insight_type": "pain|product_gap|competitive_signal|deal_friction|faq",
      "insight_subtype": "<código de la taxonomía>",
      "module": "<código del módulo o null>",
      "summary": "<resumen en español, 1-2 oraciones>",
      "verbatim_quote": "<cita textual del transcript o null>",
      "confidence": 0.0-1.0,
      "competitor_name": "<nombre normalizado o null>",
      "competitor_relationship": "<código relación o null>",
      "feature_name": "<código feature o null>",
      "gap_description": "<descripción del gap o null>",
      "gap_priority": "must_have|nice_to_have|dealbreaker|null",
      "faq_topic": "<código FAQ topic o null>"
    }
  ]
}
```

Campos obligatorios por tipo:
- **pain**: insight_subtype, summary, confidence. module si aplica.
- **product_gap**: insight_subtype="product_gap_identified", module (OBLIGATORIO), feature_name, gap_description, gap_priority
- **competitive_signal**: insight_subtype=<relationship code>, competitor_name, competitor_relationship
- **deal_friction**: insight_subtype, summary, confidence
- **faq**: insight_subtype=<faq topic code>, faq_topic, summary"""


def _load_refinements() -> str | None:
    """Load prompt refinements from QA if the file exists."""
    if not os.path.exists(REFINEMENTS_PATH):
        return None
    try:
        with open(REFINEMENTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        rules = data.get("additional_rules", [])
        if not rules:
            return None
        lines = ["# Reglas Adicionales (de QA)\n"]
        lines.append("Las siguientes reglas fueron identificadas por el proceso de QA. Aplicalas con especial atencion:\n")
        for i, rule in enumerate(rules, 1):
            lines.append(f"{i}. {rule}")
        logger.info(f"Loaded {len(rules)} prompt refinements from QA")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"Could not load refinements: {e}")
        return None


def _few_shot_examples() -> str:
    return """# Ejemplos

## Ejemplo 1: Transcript con múltiples insights

Transcript: "...necesitamos algo para comunicarnos con la gente de planta que no tiene email. Hoy usamos WhatsApp pero es un desastre, no hay control. También estamos evaluando Buk para nómina pero su módulo de comunicación es muy básico. ¿Ustedes tienen app móvil? Nuestra principal preocupación es el presupuesto, este año está muy ajustado..."

Respuesta esperada:
```json
{
  "insights": [
    {
      "insight_type": "pain",
      "insight_subtype": "deskless_exclusion",
      "module": null,
      "summary": "La empresa necesita comunicarse con personal de planta que no tiene email corporativo.",
      "verbatim_quote": "necesitamos algo para comunicarnos con la gente de planta que no tiene email",
      "confidence": 0.95,
      "competitor_name": null,
      "competitor_relationship": null,
      "feature_name": null,
      "gap_description": null,
      "gap_priority": null,
      "faq_topic": null
    },
    {
      "insight_type": "pain",
      "insight_subtype": "informal_channel_use",
      "module": "chat",
      "summary": "Usan WhatsApp para comunicaciones laborales sin control ni auditoría.",
      "verbatim_quote": "Hoy usamos WhatsApp pero es un desastre, no hay control",
      "confidence": 0.95,
      "competitor_name": null,
      "competitor_relationship": null,
      "feature_name": null,
      "gap_description": null,
      "gap_priority": null,
      "faq_topic": null
    },
    {
      "insight_type": "competitive_signal",
      "insight_subtype": "evaluating",
      "module": "payroll",
      "summary": "Están evaluando Buk para nómina pero su módulo de comunicación es limitado.",
      "verbatim_quote": "estamos evaluando Buk para nómina pero su módulo de comunicación es muy básico",
      "confidence": 0.9,
      "competitor_name": "Buk",
      "competitor_relationship": "evaluating",
      "feature_name": null,
      "gap_description": null,
      "gap_priority": null,
      "faq_topic": null
    },
    {
      "insight_type": "faq",
      "insight_subtype": "mobile",
      "module": null,
      "summary": "Pregunta si la plataforma tiene app móvil.",
      "verbatim_quote": "¿Ustedes tienen app móvil?",
      "confidence": 1.0,
      "competitor_name": null,
      "competitor_relationship": null,
      "feature_name": null,
      "gap_description": null,
      "gap_priority": null,
      "faq_topic": "mobile"
    },
    {
      "insight_type": "deal_friction",
      "insight_subtype": "budget",
      "module": null,
      "summary": "Restricción presupuestaria, el presupuesto del año está muy ajustado.",
      "verbatim_quote": "Nuestra principal preocupación es el presupuesto, este año está muy ajustado",
      "confidence": 0.9,
      "competitor_name": null,
      "competitor_relationship": null,
      "feature_name": null,
      "gap_description": null,
      "gap_priority": null,
      "faq_topic": null
    }
  ]
}
```"""
