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
    PRODUCT_GAP_SUBTYPES, COMPETITOR_CATEGORIES,
)

logger = logging.getLogger(__name__)

REFINEMENTS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "prompt_refinements.json")


def build_system_prompt() -> str:
    """Build the full system prompt with taxonomy and instructions."""
    sections = [
        _header(),
        _taxonomy_modules(),
        _taxonomy_pains(),
        _taxonomy_product_gap_subtypes(),
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
| Dolor / Problema | `pain` | El prospecto describe un problema, frustracion o necesidad actual **de su organizacion** |
| Feature Faltante | `product_gap` | El prospecto pide una funcionalidad especifica **de Humand** que no existe o es insuficiente |
| Senal Competitiva | `competitive_signal` | Se menciona un competidor (lo usan, evaluan, migran) |
| Friccion del Deal | `deal_friction` | Algo que frena o **bloquea el avance de la compra** |
| Pregunta Frecuente | `faq` | El prospecto hace una **pregunta general** sobre Humand |

## Reglas de discriminacion entre tipos

**Pain vs Product Gap:**
- Un PAIN describe un problema que el prospecto EXPERIMENTA HOY en su organizacion ("No tenemos manera de medir el clima").
- Un PRODUCT GAP describe una funcionalidad especifica que el prospecto QUIERE DE HUMAND ("¿Tienen modulo de nomina?", "Necesitamos integracion con SAP").
- Si el prospecto describe un problema general → pain. Si pide una feature concreta → product_gap.
- NO emitir ambos para la misma frase. Solo emitir ambos si el transcript contiene TANTO una descripcion del problema COMO un pedido explicito de feature.

**FAQ vs Product Gap:**
- Si el prospecto PREGUNTA si una capacidad existe → faq.
- Si el vendedor CONFIRMA que no existe, o el modulo/feature esta marcado como missing → product_gap.
- En caso de duda, preferir faq.

**Deal Friction vs Pain:**
- Si el prospecto describe un problema de su organizacion → pain.
- Si el prospecto describe algo que BLOQUEA LA COMPRA de Humand → deal_friction.

## Reglas de asignacion del campo `module`

| Insight Type | `module` | Regla |
|-------------|----------|-------|
| `pain` | Opcional | Indica DONDE ocurre el dolor. Si el dolor es general, omitir |
| `product_gap` | **Obligatorio** | Indica QUE modulo se necesita. Siempre debe asignarse |
| `competitive_signal` | Opcional | Solo si el competidor cubre un modulo especifico mencionado |
| `deal_friction` | No usar | Las fricciones son sobre el proceso de compra, no sobre modulos |
| `faq` | Opcional | Solo si la pregunta es sobre un modulo especifico |

Reglas adicionales:
1. Usa SOLO los codigos de la taxonomia que se lista abajo
2. Si un feature no esta en la seed list, crea un codigo nuevo en formato slug (lowercase, underscores)
3. Cada insight debe tener un `summary` en espanol, conciso (1-2 oraciones)
4. Incluye `verbatim_quote` siempre que sea posible (cita textual del transcript)
5. El campo `confidence` va de 0 a 1 (1 = certeza total, 0.5 = inferido del contexto)
6. NO inventes insights que no esten en el transcript
7. Si no hay insights de algun tipo, simplemente no los incluyas"""


def _taxonomy_modules() -> str:
    lines = ["# Taxonomia: Modulos HR\n"]
    lines.append("| Codigo Modulo | Display Name | Categoria HR | Status |")
    lines.append("|---|---|---|---|")
    for code, m in MODULES.items():
        cat_display = HR_CATEGORIES[m["hr_category"]]["display_name"]
        lines.append(f"| `{code}` | {m['display_name']} | {cat_display} | {m['status']} |")

    # Add aliases section
    lines.append("\n## Aliases de Modulos (para reconocer menciones)")
    lines.append("Cuando el prospecto mencione cualquiera de estos terminos, mapealo al modulo correspondiente:\n")

    # Group aliases by module
    aliases_by_module: dict[str, list[str]] = {}
    for alias, module_code in MODULE_ALIASES.items():
        aliases_by_module.setdefault(module_code, []).append(alias)

    for module_code, aliases in sorted(aliases_by_module.items()):
        if module_code not in MODULES:
            continue
        display = MODULES[module_code]["display_name"]
        lines.append(f"- **{display}** (`{module_code}`): {', '.join(aliases)}")

    return "\n".join(lines)


def _taxonomy_pains() -> str:
    lines = ["# Taxonomia: Pain Subtypes (31)\n"]
    lines.append("Los pains describen el PATRON del dolor. El campo `module` captura por separado DONDE ocurre. Son dimensiones independientes.\n")

    # Group by theme
    by_theme: dict[str, list[tuple[str, dict]]] = {}
    for code, p in PAIN_SUBTYPES.items():
        by_theme.setdefault(p["theme"], []).append((code, p))

    theme_names = {
        "technology": "Problemas de herramientas y sistemas",
        "processes": "Ineficiencias operativas",
        "communication": "Flujo de informacion",
        "talent": "Atraccion, desarrollo y retencion",
        "engagement": "Cultura, pertenencia y clima",
        "data_and_analytics": "Visibilidad y reportes",
        "compliance_and_scale": "Regulatorio y crecimiento",
    }

    for theme, theme_label in theme_names.items():
        pains = by_theme.get(theme, [])
        if not pains:
            continue
        lines.append(f"\n## Theme: `{theme}` — {theme_label}")
        lines.append("| Codigo | Display Name | Descripcion |")
        lines.append("|---|---|---|")
        for code, p in pains:
            lines.append(f"| `{code}` | {p['display_name']} | {p['description']} |")

    return "\n".join(lines)


def _taxonomy_product_gap_subtypes() -> str:
    lines = ["# Taxonomia: Product Gap Subtypes (5)\n"]
    lines.append("Cada product_gap debe tener un `insight_subtype` de esta lista. Clasifica QUE TIPO de brecha es.\n")
    lines.append("| Codigo | Display Name | Cuando usarlo |")
    lines.append("|---|---|---|")
    for code, pg in PRODUCT_GAP_SUBTYPES.items():
        lines.append(f"| `{code}` | {pg['display_name']} | {pg['description']} |")
    lines.append("\n**Regla para modulos `missing` o `roadmap`**: Cuando el prospecto pregunta por un modulo marcado como `missing` o `roadmap`, emitir product_gap con subtype `missing_capability`.")
    return "\n".join(lines)


def _taxonomy_deal_friction() -> str:
    lines = ["# Taxonomia: Deal Friction Subtypes\n"]
    lines.append("| Codigo | Display Name | Descripcion |")
    lines.append("|---|---|---|")
    for code, d in DEAL_FRICTION_SUBTYPES.items():
        lines.append(f"| `{code}` | {d['display_name']} | {d['description']} |")
    return "\n".join(lines)


def _taxonomy_faq() -> str:
    lines = ["# Taxonomia: FAQ Subtypes\n"]
    lines.append("| Codigo | Display Name | Descripcion |")
    lines.append("|---|---|---|")
    for code, f in FAQ_SUBTYPES.items():
        lines.append(f"| `{code}` | {f['display_name']} | {f['description']} |")
    return "\n".join(lines)


def _taxonomy_competitive() -> str:
    lines = ["# Taxonomia: Competitive Relationships\n"]
    lines.append("| Codigo | Display Name | Cuando usarlo |")
    lines.append("|---|---|---|")
    for code, c in COMPETITIVE_RELATIONSHIPS.items():
        lines.append(f"| `{code}` | {c['display_name']} | {c['description']} |")
    return "\n".join(lines)


def _taxonomy_product_gap() -> str:
    lines = ["# Taxonomia: Product Gap - Feature Names (seed list)\n"]
    lines.append("Usa estos codigos cuando apliquen. Si la feature no esta en la lista, crea un codigo nuevo en formato slug.\n")
    lines.append("| Codigo | Display Name | Modulo Sugerido |")
    lines.append("|---|---|---|")
    for code, f in SEED_FEATURE_NAMES.items():
        mod = f.get("suggested_module") or "—"
        lines.append(f"| `{code}` | {f['display_name']} | {mod} |")
    lines.append("\n**gap_priority:** `must_have` (lo necesitan si o si), `nice_to_have` (seria bueno tenerlo), `dealbreaker` (sin esto no compran)")
    return "\n".join(lines)


def _taxonomy_competitors() -> str:
    lines = ["# Competidores Conocidos\n"]
    lines.append("Normaliza el nombre del competidor al de esta lista. Si no esta, usa el nombre tal como lo menciona el prospecto.\n")

    by_category: dict[str, list[tuple[str, str]]] = {}
    for name, info in COMPETITORS.items():
        cat = info["category"]
        by_category.setdefault(cat, []).append((name, info["region"]))

    for cat_code, cat_info in COMPETITOR_CATEGORIES.items():
        entries = by_category.get(cat_code, [])
        if not entries:
            continue
        lines.append(f"\n**{cat_info['display_name']}** (`{cat_code}`):")
        names_by_region: dict[str, list[str]] = {}
        for name, region in entries:
            names_by_region.setdefault(region, []).append(name)
        for region, names in sorted(names_by_region.items()):
            label = region.upper().replace("_", " ")
            lines.append(f"  {label}: {', '.join(sorted(names))}")

    return "\n".join(lines)


def _output_instructions() -> str:
    return """# Formato de Salida

Responde con un JSON que contenga una lista de insights. Cada insight tiene estos campos:

```
{
  "insights": [
    {
      "insight_type": "pain|product_gap|competitive_signal|deal_friction|faq",
      "insight_subtype": "<codigo de la taxonomia>",
      "module": "<codigo del modulo o null>",
      "summary": "<resumen en espanol, 1-2 oraciones>",
      "verbatim_quote": "<cita textual del transcript o null>",
      "confidence": 0.0-1.0,
      "competitor_name": "<nombre normalizado o null>",
      "competitor_relationship": "<codigo relacion o null>",
      "feature_name": "<codigo feature o null>",
      "gap_description": "<descripcion del gap o null>",
      "gap_priority": "must_have|nice_to_have|dealbreaker|null",
      "faq_topic": "<codigo FAQ topic o null>"
    }
  ]
}
```

Campos obligatorios por tipo:
- **pain**: insight_subtype (codigo pain), summary, confidence. module si aplica.
- **product_gap**: insight_subtype (uno de: missing_capability, insufficient_depth, missing_integration, ux_limitation, scalability_limitation), module (OBLIGATORIO), feature_name, gap_description, gap_priority
- **competitive_signal**: insight_subtype=<relationship code>, competitor_name, competitor_relationship
- **deal_friction**: insight_subtype (codigo deal_friction), summary, confidence
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

## Ejemplo 1: Transcript con multiples insights

Transcript: "...necesitamos algo para comunicarnos con la gente de planta que no tiene email. Hoy usamos WhatsApp pero es un desastre, no hay control. Tambien estamos evaluando Buk para nomina pero su modulo de comunicacion es muy basico. ¿Ustedes tienen app movil? Nuestra principal preocupacion es el presupuesto, este ano esta muy ajustado..."

Respuesta esperada:
```json
{
  "insights": [
    {
      "insight_type": "pain",
      "insight_subtype": "unreachable_employees",
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
      "insight_subtype": "informal_channels",
      "module": "chat",
      "summary": "Usan WhatsApp para comunicaciones laborales sin control ni auditoria.",
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
      "summary": "Estan evaluando Buk para nomina pero su modulo de comunicacion es limitado.",
      "verbatim_quote": "estamos evaluando Buk para nomina pero su modulo de comunicacion es muy basico",
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
      "summary": "Pregunta si la plataforma tiene app movil.",
      "verbatim_quote": "¿Ustedes tienen app movil?",
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
      "summary": "Restriccion presupuestaria, el presupuesto del ano esta muy ajustado.",
      "verbatim_quote": "Nuestra principal preocupacion es el presupuesto, este ano esta muy ajustado",
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
