"""
Prompt de extraccion AE-side: como el equipo de Sales explica Humand.

Distinto en un punto clave del prompt lead-side (prompt_builder.py): ahi el
riesgo es perderse insights; aca el riesgo es INVENTAR. El output alimenta un
bot que le habla a leads reales, asi que el prompt esta sesgado a no extraer
antes que a extraer algo dudoso.
"""

from __future__ import annotations

from taxonomy import HR_CATEGORIES, MODULES

AE_PROMPT_VERSION = "ae_v1"


def build_ae_system_prompt() -> str:
    return "\n\n".join([
        _header(),
        _unit_types(),
        _taxonomy_modules(),
        _rules(),
        _output_format(),
        _few_shots(),
    ])


def build_ae_user_prompt(transcript_text: str, metadata: dict) -> str:
    """Prompt de usuario con contexto de CRM + identificacion del AE + transcript."""
    field_map = {
        "company_name": "Empresa",
        "country": "Pais",
        "region": "Region",
        "industry": "Industria",
        "segment": "Segmento",
        "deal_stage": "Etapa",
        "call_date": "Fecha",
    }
    context = [f"- {label}: {metadata[f]}" for f, label in field_map.items() if metadata.get(f)]
    context_str = "\n".join(context) if context else "- Sin contexto CRM disponible"

    humand = []
    if metadata.get("deal_owner"):
        humand.append(f"{metadata['deal_owner']} (AE)")
    if metadata.get("cx_owner") and metadata["cx_owner"] != metadata.get("deal_owner"):
        humand.append(f"{metadata['cx_owner']} (CX)")

    if humand:
        who = (
            f"Las personas de Humand en esta llamada son: {', '.join(humand)}.\n"
            "Cualquier otro hablante es el prospecto (lead) y NO debe extraerse.\n"
            "Completa `speaker_name` con el nombre tal como figura en el transcript."
        )
    else:
        who = (
            "NO hay dato de quien es el AE en este deal. Solo extrae unidades donde el rol\n"
            "del hablante sea inequivoco por el contenido (por ejemplo, esta explicando el\n"
            "producto o respondiendo una pregunta sobre Humand). Ante cualquier duda, no\n"
            "extraigas la unidad. Usa `confidence` <= 0.6 en todas las unidades de esta llamada."
        )

    return f"""## Contexto del Deal

{context_str}

## Quien es quien

{who}

## Transcript

{transcript_text}"""


# ── Secciones ──

def _header() -> str:
    return """# Rol y objetivo

Eres un analista de sales enablement. Tu tarea es extraer, del transcript de una
llamada de ventas, COMO HABLA EL AE DE HUMAND: como explica que es Humand, como
presenta cada modulo, como responde preguntas y objeciones, y que terminos usa.

NO te interesa lo que dice el prospecto. Lo que dice el prospecto (sus dolores,
sus pedidos, sus objeciones) ya se extrae en otro proceso. Aca el prospecto solo
aparece como `trigger`: el disparador de lo que dijo el AE.

El resultado alimenta dos cosas: un playbook para el equipo comercial y la base
de conocimiento de un bot de WhatsApp que califica leads. Por eso una cita
inventada o mal atribuida es mucho peor que una cita que no extrajiste."""


def _unit_types() -> str:
    return """# Tipos de unidad

| Codigo | Que capturar |
|---|---|
| `pitch_company` | El AE explica que es Humand / que hace la empresa / para que sirve, a nivel general. El pitch de apertura tipico. |
| `pitch_module` | El AE explica un modulo o funcionalidad concreta. Requiere `module`. |
| `faq_answer` | El AE responde una pregunta informativa del lead (precio, implementacion, integraciones, seguridad, soporte, idiomas). Requiere `trigger` con la pregunta. |
| `objection_handling` | El AE responde algo que frena la venta (presupuesto, timing, "ya tenemos otra herramienta", "lo tengo que ver con RRHH"). Requiere `trigger`. |
| `discovery_question` | Pregunta que el AE le hace al lead para calificarlo o entender su situacion. |
| `proof_point` | El AE usa un caso, cliente, numero o metrica como prueba ("X empresas ya lo usan", "implementamos en 3 semanas"). |

Una misma intervencion del AE puede generar varias unidades si toca varios
modulos o mezcla pitch con proof point. No dupliques la misma idea en dos tipos."""


def _taxonomy_modules() -> str:
    lines = ["# Modulos (taxonomia)", "", "Usa SIEMPRE el codigo, nunca el display name."]
    by_cat: dict[str, list[str]] = {}
    for code, meta in MODULES.items():
        by_cat.setdefault(meta["hr_category"], []).append(f"`{code}` ({meta['display_name']})")
    for cat, mods in by_cat.items():
        label = HR_CATEGORIES.get(cat, {}).get("display_name") or cat.replace("_", " ").title()
        lines.append(f"\n**{label}:** {', '.join(sorted(mods))}")
    lines.append(
        "\nSi el AE habla de una funcionalidad que no matchea ningun codigo, deja "
        "`module` en null y que la funcionalidad quede reflejada en `terms`."
    )
    return "\n".join(lines)


def _rules() -> str:
    return """# Reglas

1. **`verbatim_quote` es textual.** Copia literal de lo que dijo el AE, incluidas
   muletillas y errores. No lo edites, no lo resumas, no lo "mejores". Si no
   podes copiar la frase literal del transcript, no extraigas la unidad.
2. **Solo el AE.** Si el hablante no es una de las personas de Humand indicadas,
   descartalo. Nunca atribuyas al AE algo que dijo el lead.
3. **No inventes producto.** No agregues features, precios ni numeros que el AE no
   dijo. En `gloss` describi el sentido con el que uso el termino, no la
   definicion oficial del producto.
4. **Ignora lo que no sirve.** Saludos, coordinacion de agenda, problemas de
   audio, "me escuchas?", chistes, cierre de la llamada.
5. **Unidades sustanciales.** Una frase de menos de ~8 palabras rara vez es una
   unidad util. "Si, eso lo tenemos" no es un `faq_answer`.
6. **`trigger` obligatorio** en `faq_answer` y `objection_handling`: la pregunta u
   objecion del lead, textual y abreviada. Sin trigger, la respuesta no se
   entiende fuera de contexto y es inutil para el bot.
7. **`confidence` honesta.** Bajala ante duda de atribucion o de literalidad.
   No uses 0.9+ salvo que el hablante este etiquetado y la cita sea copia exacta.
8. **Maximo 12 unidades por chunk.** Si hay mas, quedate con las mas
   representativas del discurso del AE.
9. Si el chunk no tiene nada del AE que califique, devolve `{"units": []}`. Es
   una respuesta valida y esperada — no fuerces extracciones."""


def _output_format() -> str:
    return """# Formato de salida

```json
{
  "units": [
    {
      "unit_type": "pitch_company|pitch_module|faq_answer|objection_handling|discovery_question|proof_point",
      "module": "<codigo del modulo o null>",
      "verbatim_quote": "<cita textual del AE>",
      "paraphrase": "<la misma idea en 1-2 oraciones limpias, en español>",
      "trigger": "<lo que dijo el lead y detono esto, o null>",
      "terms": [
        {"term": "<termino tal como lo dijo>", "module": "<codigo o null>", "gloss": "<como lo explico, 1 oracion>"}
      ],
      "speaker_name": "<nombre del hablante en el transcript o null>",
      "confidence": 0.0-1.0
    }
  ]
}
```"""


def _few_shots() -> str:
    return """# Ejemplos

## Ejemplo 1 — pitch de empresa + termino

Transcript:
```
Ana Torres: Contame un poco, que es Humand?
Martin Diaz: Mira, Humand es una super app para empleados. La idea es que en vez
de tener el intranet por un lado, el chat por otro, los recibos en un mail,
todo eso vive en una sola app que el colaborador tiene en el celular. Nosotros
le decimos experiencia del colaborador de punta a punta.
```
Salida:
```json
{"units": [{
  "unit_type": "pitch_company",
  "module": null,
  "verbatim_quote": "Humand es una super app para empleados. La idea es que en vez de tener el intranet por un lado, el chat por otro, los recibos en un mail, todo eso vive en una sola app que el colaborador tiene en el celular.",
  "paraphrase": "Humand se presenta como una super app unica para el colaborador, que reemplaza herramientas dispersas (intranet, chat, recibos por mail) desde el celular.",
  "trigger": "Contame un poco, que es Humand?",
  "terms": [{"term": "super app para empleados", "module": null, "gloss": "Una sola app movil que concentra todas las herramientas del colaborador."},
            {"term": "experiencia del colaborador de punta a punta", "module": null, "gloss": "Cubrir todo el ciclo del colaborador en un mismo lugar."}],
  "speaker_name": "Martin Diaz",
  "confidence": 0.95
}]}
```

## Ejemplo 2 — objecion + proof point

Transcript:
```
Ana Torres: El tema es que ya tenemos Workplace y la gente recien se acostumbro.
Martin Diaz: Te entiendo, pasa seguido. Lo que vemos es que Workplace te resuelve
la comunicacion pero no la parte de administracion de RRHH, entonces igual
seguis con procesos por mail. En los casos que migraron de Workplace la adopcion
nos dio arriba del 80% en el primer mes porque el colaborador encuentra todo ahi.
```
Salida:
```json
{"units": [
  {
    "unit_type": "objection_handling",
    "module": null,
    "verbatim_quote": "Lo que vemos es que Workplace te resuelve la comunicacion pero no la parte de administracion de RRHH, entonces igual seguis con procesos por mail.",
    "paraphrase": "Frente a la objecion de tener ya Workplace, el AE lo encuadra como herramienta solo de comunicacion, que deja la administracion de RRHH sin resolver.",
    "trigger": "ya tenemos Workplace y la gente recien se acostumbro",
    "terms": [],
    "speaker_name": "Martin Diaz",
    "confidence": 0.9
  },
  {
    "unit_type": "proof_point",
    "module": null,
    "verbatim_quote": "En los casos que migraron de Workplace la adopcion nos dio arriba del 80% en el primer mes porque el colaborador encuentra todo ahi.",
    "paraphrase": "Usa como prueba una adopcion superior al 80% en el primer mes en clientes que migraron desde Workplace.",
    "trigger": null,
    "terms": [{"term": "adopcion", "module": null, "gloss": "Porcentaje de colaboradores que usan efectivamente la app."}],
    "speaker_name": "Martin Diaz",
    "confidence": 0.9
  }
]}
```

## Ejemplo 3 — nada que extraer

Transcript:
```
Martin Diaz: Ahi te comparto pantalla, me ves?
Ana Torres: Si, ahora si.
Martin Diaz: Perfecto. Un segundo que abro la demo.
```
Salida:
```json
{"units": []}
```"""
