"""
Pydantic models para la extraccion AE-side (como habla el equipo de Sales),
separada de models.py que es lead-side (pains, gaps, competencia, fricciones).

Por que un modelo aparte y no un insight_type mas en transcript_insights:
la MV (mv_insights_norm), sus RPCs y ~14 vistas del dashboard asumen la forma
actual de la tabla. Meter unidades de discurso del AE ahi contamina todos los
conteos ("total de insights", "insights por demo") sin ganar nada. Mismo patron
aislado que competitor_ads.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from models import _make_strict_compatible


class UnitType(str, Enum):
    """Que tipo de cosa dijo el AE."""

    pitch_company = "pitch_company"          # que es Humand / que hacemos, a nivel empresa
    pitch_module = "pitch_module"            # como explica un modulo o funcionalidad
    faq_answer = "faq_answer"                # respuesta a una pregunta del lead
    objection_handling = "objection_handling"  # respuesta a una objecion o duda bloqueante
    discovery_question = "discovery_question"  # pregunta que el AE le hace al lead para calificar
    proof_point = "proof_point"              # caso, cliente, numero o metrica que usa como prueba


class TermUsage(BaseModel):
    """Un termino de jerga tal como lo usa el AE, para el glosario."""

    term: str = Field(
        description="El termino tal cual lo dijo el AE (ej. 'clima laboral', 'people analytics')"
    )
    module: Optional[str] = Field(
        default=None,
        description="Codigo del modulo de la taxonomia al que se refiere, o null si no aplica",
    )
    gloss: str = Field(
        description="Como lo explico el AE, en una oracion, en español. Si no lo explico, "
                    "describir el sentido con el que lo uso. Nunca inventar definiciones de producto."
    )


class AeSpeechUnit(BaseModel):
    """Una unidad de discurso del AE extraida de un chunk de transcript."""

    unit_type: UnitType
    module: Optional[str] = Field(
        default=None,
        description="Codigo del modulo de la taxonomia. Obligatorio para pitch_module, "
                    "null si la unidad no habla de un modulo especifico.",
    )
    verbatim_quote: str = Field(
        description="Cita TEXTUAL de lo que dijo el AE. Sin editar, sin resumir, sin corregir "
                    "la gramatica oral. Este campo es el producto: si no es textual, no sirve."
    )
    paraphrase: str = Field(
        description="La misma idea en 1-2 oraciones limpias, en español, sin muletillas. "
                    "Esto es lo que se muestra en el resumen de 'formas de explicar'."
    )
    trigger: Optional[str] = Field(
        default=None,
        description="Que dijo el lead inmediatamente antes y detono esta unidad (pregunta u "
                    "objecion), textual y abreviado. null si el AE lo dijo sin que se lo pidan.",
    )
    terms: list[TermUsage] = Field(
        default_factory=list,
        description="Terminos de jerga que el AE uso en esta unidad. Lista vacia si ninguno.",
    )
    speaker_name: Optional[str] = Field(
        default=None,
        description="Nombre del hablante tal como aparece en el transcript, para poder auditar "
                    "la atribucion. null si el transcript no lo etiqueta.",
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="Confianza en que (a) lo dijo el AE y no el lead, y (b) la cita es textual. "
                    "Bajar a <0.5 ante cualquier duda de atribucion.",
    )


class AeSpeechResponse(BaseModel):
    """Lo que devuelve el LLM por chunk."""

    units: list[AeSpeechUnit]


def get_ae_json_schema() -> dict:
    """response_format para OpenAI structured output (strict mode)."""
    schema = AeSpeechResponse.model_json_schema()
    _make_strict_compatible(schema)
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "ae_speech_units",
            "strict": True,
            "schema": schema,
        },
    }
