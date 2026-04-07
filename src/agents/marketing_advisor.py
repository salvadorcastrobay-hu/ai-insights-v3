"""
Agente: Marketing Campaign Advisor.

Orquesta las skills de pipeline y segmento para generar recomendaciones
de campanas de marketing respaldadas por data real de demos y pipeline.

Principios de diseno:
- expose_methodology() es deterministico: sin LLM ni DB.
- El LLM solo razona sobre datos que recibio como input.
- La metadata critica de salida (idioma, tono, confianza y ventana temporal)
  se resuelve de forma deterministica para evitar drift del modelo.
"""
from __future__ import annotations

import ast
import json
import os
import re
from datetime import date, timedelta
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator
from src.agents.humand_context import build_humand_brand_context, get_module_status_label

if TYPE_CHECKING:
    from src.skills.pipeline_stats import PipelineBreakdown
    from src.skills.segment_insights import SegmentInsights


load_dotenv()


ALLOWED_ACTION_TYPES = (
    "content_campaign",
    "webinar",
    "case_study",
    "email_sequence",
    "landing_page",
    "paid_ad",
    "sales_enablement",
)
ALLOWED_LAUNCH_READINESS = ("ready_now", "validate_first")


class CampaignAnglePayload(BaseModel):
    rank: int = Field(ge=1, le=3)
    action_type: Literal[
        "content_campaign",
        "webinar",
        "case_study",
        "email_sequence",
        "landing_page",
        "paid_ad",
        "sales_enablement",
    ]
    title: str = Field(min_length=1)
    target_audience: str = Field(min_length=1)
    hero_message: str = Field(min_length=1)
    core_message: str = Field(min_length=1)
    key_pain_addressed: str = Field(min_length=1)
    supporting_data: str = Field(min_length=1)
    qualification_checks: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    content_ideas: list[str] = Field(default_factory=list)
    priority: Literal["high", "medium", "low"] = "medium"
    launch_readiness: Literal["ready_now", "validate_first"] = "validate_first"
    rationale: str = ""


class MarketingRecommendationPayload(BaseModel):
    segment_summary: str = Field(min_length=1)
    recommended_market_language: str = Field(min_length=1)
    market_tone: str = Field(min_length=1)
    confidence_reason: str = Field(min_length=1)
    freshness_window: str = Field(min_length=1)
    qualification_summary: list[str] = Field(default_factory=list)
    recommended_angles: list[CampaignAnglePayload] = Field(min_length=2, max_length=3)
    what_not_to_do: list[str] = Field(default_factory=list)
    data_confidence: Literal["high", "medium", "low"]

    @field_validator("what_not_to_do", "qualification_summary")
    @classmethod
    def _trim_empty_items(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item and item.strip()]


class TranslatedCampaignAnglePayload(BaseModel):
    rank: int = Field(ge=1, le=3)
    title: str = Field(min_length=1)
    target_audience: str = Field(min_length=1)
    hero_message: str = Field(min_length=1)
    core_message: str = Field(min_length=1)
    key_pain_addressed: str = Field(min_length=1)
    supporting_data: str = Field(min_length=1)
    qualification_checks: list[str] = Field(default_factory=list)
    content_ideas: list[str] = Field(default_factory=list)
    rationale: str = ""


class TranslatedRecommendationPayload(BaseModel):
    segment_summary: str = Field(min_length=1)
    market_tone: str = Field(min_length=1)
    confidence_reason: str = Field(min_length=1)
    qualification_summary: list[str] = Field(default_factory=list)
    recommended_angles: list[TranslatedCampaignAnglePayload] = Field(min_length=2, max_length=3)
    what_not_to_do: list[str] = Field(default_factory=list)


@dataclass
class CampaignAngle:
    """Un angulo de campana de marketing recomendado."""

    rank: int
    action_type: str
    title: str
    target_audience: str
    hero_message: str
    core_message: str
    key_pain_addressed: str
    supporting_data: str
    qualification_checks: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    content_ideas: list[str] = field(default_factory=list)
    priority: str = "medium"
    launch_readiness: str = "validate_first"
    rationale: str = ""


@dataclass
class MarketingRecommendation:
    """Resultado completo del analisis del Campaign Advisor."""

    segment_summary: str
    recommended_market_language: str
    market_tone: str
    confidence_reason: str
    freshness_window: str
    qualification_summary: list[str]
    recommended_angles: list[CampaignAngle]
    what_not_to_do: list[str]
    data_confidence: str
    sample_size: int
    filters_applied: dict
    model_used: str = ""
    error: str = ""


class MarketingAdvisorAgent:
    """
    Agente que genera recomendaciones de campanas de marketing
    basadas en datos reales del pipeline y transcripts de demos.
    """

    MIN_SAMPLE = 3
    DEFAULT_LOOKBACK_DAYS = 180

    def __init__(self, model: str | None = None) -> None:
        """
        Inicializa el cliente de OpenAI.

        El modelo se resuelve en este orden:
          1. Argumento `model`
          2. Variable de entorno `OPENAI_MARKETING_MODEL`
          3. Default: "gpt-5.4"
        """
        try:
            from openai import OpenAI
        except Exception as exc:  # pragma: no cover - depends on local env
            raise RuntimeError(
                "Falta instalar la libreria `openai`. Ejecuta `pip install -r requirements.txt`."
            ) from exc

        api_key = self._get_api_key()
        self.client = OpenAI(api_key=api_key)
        self.model = (
            model
            or os.getenv("OPENAI_MARKETING_MODEL")
            or "gpt-5.4"
        )

    def _get_api_key(self) -> str:
        """Obtiene OPENAI_API_KEY del entorno o de st.secrets."""
        val = os.environ.get("OPENAI_API_KEY")
        if val:
            return val
        try:
            import streamlit as st

            key = st.secrets.get("OPENAI_API_KEY")
            if key:
                return key
        except Exception:
            pass
        raise RuntimeError(
            "Falta configurar OPENAI_API_KEY. "
            "Agregalo en las variables de entorno o en st.secrets."
        )

    def _normalize_filters(self, filters: dict) -> dict:
        """Aplica defaults del advisor, especialmente la ventana temporal reciente."""
        normalized = dict(filters or {})
        end_date = normalized.get("end_date")
        start_date = normalized.get("start_date")
        today = date.today()

        if not end_date:
            end_date = today.isoformat()
        if not start_date:
            start_date = (today - timedelta(days=self.DEFAULT_LOOKBACK_DAYS)).isoformat()

        normalized["start_date"] = start_date
        normalized["end_date"] = end_date
        return normalized

    def _first_filter_value(self, value):
        if isinstance(value, list):
            return value[0] if value else ""
        return value or ""

    def _format_filter_value(self, value) -> str:
        if isinstance(value, list):
            return ", ".join(str(item) for item in value)
        return str(value)

    def _determine_market_guidance(self, filters: dict) -> tuple[str, str]:
        """Devuelve idioma y tono recomendados para la salida market-facing."""
        country = str(self._first_filter_value(filters.get("country"))).strip().lower()
        region = str(self._first_filter_value(filters.get("region"))).strip()

        if country in {"brasil", "brazil"} or region == "Brazil":
            return (
                "pt-BR",
                "Direto, operacional, simples, orientado a frontline e adocao. Evita jargoes e overclaim.",
            )
        if region == "ANGLO AMERICA" or country in {"united states", "usa", "canada"}:
            return (
                "en-US",
                "Clear, concise, proof-driven, operational, and low-hype.",
            )
        if country in {"spain", "españa"}:
            return (
                "es-ES",
                "Directo, concreto y profesional, con foco en valor operativo.",
            )
        if region == "EMEA":
            return (
                "en-GB",
                "Proof-driven, operational, easy to localize, and conservative with claims.",
            )
        return (
            "es-LATAM",
            "Directo, concreto y orientado a operacion, adopcion y valor demostrable.",
        )

    def _deterministic_confidence(self, sample_size: int) -> tuple[str, str]:
        """Calcula confianza de forma deterministica segun tamano de muestra."""
        if sample_size < 15:
            return (
                "low",
                f"Muestra chica ({sample_size} demos). Usar solo como senal exploratoria y validar con ventas antes de lanzar.",
            )
        if sample_size < 60:
            return (
                "medium",
                f"Muestra intermedia ({sample_size} demos). Hay senales utiles, pero conviene validar el mensaje con ventas o un test chico.",
            )
        return (
            "high",
            f"Muestra robusta ({sample_size} demos). La direccion es suficientemente estable para priorizarla y testear ejecucion.",
        )

    def expose_methodology(self, filters: dict) -> list[str]:
        """
        Retorna la lista de pasos que se ejecutaran al generar la recomendacion.
        Completamente deterministico: no llama al LLM ni a la base de datos.
        """
        filters = self._normalize_filters(filters)
        active = {k: v for k, v in filters.items() if v}
        filter_desc = (
            ", ".join(f"{k}={self._format_filter_value(v)}" for k, v in active.items())
            if active else "todos los segmentos"
        )

        return [
            "1. Inyectar contexto first-party de Humand: que hacemos, modulos existentes/missing y catalogo competitivo curado",
            f"2. Aplicar una ventana temporal reciente por defecto ({filters['start_date']} a {filters['end_date']}) si el usuario no definio otra",
            f"3. Analizar composicion del pipeline ({filter_desc}): deals, revenue y distribucion por industria, pais, region, segmento y etapa",
            "4. Respetar la ventana temporal efectiva: create_date para pipeline y call_date para demos",
            "5. Extraer los principales pain points, FAQs, modulos, competidores y feature gaps del segmento",
            "6. Determinar confianza de forma automatica segun tamano de muestra y orientar el idioma/tono segun mercado",
            "7. Formatear toda la evidencia en un contexto estructurado y restringido para el modelo",
            "8. Pedir 2-3 angulos de campana rankeados, con strengths en el hero y caveats/gaps en bloques de calificacion",
        ]

    def build_context(self, filters: dict) -> tuple["PipelineBreakdown", "SegmentInsights"]:
        """
        Llama a las skills de pipeline y segmento para construir el contexto.

        Raises:
            ValueError: Si hay menos de MIN_SAMPLE transcripts en el segmento.
        """
        from src.skills.pipeline_stats import get_pipeline_breakdown
        from src.skills.segment_insights import get_segment_insights

        filters = self._normalize_filters(filters)

        pipeline = get_pipeline_breakdown(filters)
        insights = get_segment_insights(filters)

        if insights.sample_size < self.MIN_SAMPLE:
            filter_desc = (
                ", ".join(f"{k}={self._format_filter_value(v)}" for k, v in filters.items() if v)
                or "sin filtros"
            )
            raise ValueError(
                f"Datos insuficientes para el segmento seleccionado ({filter_desc}). "
                f"Se encontraron {insights.sample_size} demo(s), "
                f"se necesitan al menos {self.MIN_SAMPLE}. "
                f"Proba con filtros mas amplios."
            )

        return pipeline, insights

    def generate_recommendations(
        self,
        filters: dict,
        question: str = "",
        pipeline=None,
        insights=None,
    ) -> MarketingRecommendation:
        """
        Genera recomendaciones de campanas de marketing basadas en los datos del segmento.
        """
        filters = self._normalize_filters(filters)
        if pipeline is None or insights is None:
            pipeline, insights = self.build_context(filters)

        context_text = self._format_context(pipeline, insights, filters)
        raw_response = self._call_openai(context_text, question)
        recommendation = self._parse_recommendation(raw_response, filters, insights.sample_size)
        if recommendation.error and raw_response.strip():
            repaired_response = self._repair_response(raw_response)
            if repaired_response.strip():
                repaired_recommendation = self._parse_recommendation(
                    repaired_response,
                    filters,
                    insights.sample_size,
                )
                if not repaired_recommendation.error:
                    recommendation = repaired_recommendation
        recommendation.model_used = self.model
        return recommendation

    def translate_recommendation(
        self, recommendation: MarketingRecommendation, target_language: str
    ) -> MarketingRecommendation:
        """Traduce la recomendacion ya generada sin volver a consultar la data del segmento."""
        normalized_target = (target_language or "").strip()
        if not normalized_target or normalized_target == recommendation.recommended_market_language:
            return recommendation

        payload = self._recommendation_translation_payload(recommendation)
        raw_response = self._call_translation_model(payload, normalized_target)
        translated = self._parse_translated_recommendation(
            raw_response,
            recommendation,
            normalized_target,
        )
        translated.model_used = recommendation.model_used or self.model
        return translated

    def answer_followup(
        self,
        question: str,
        recommendation: MarketingRecommendation,
        pipeline,
        insights,
        target_language: str = "",
        chat_history: list[dict] | None = None,
    ) -> str:
        """Responde preguntas sobre el plan ya generado sin volver a recalcular el segmento."""
        prompt = self._build_followup_prompt(target_language or recommendation.recommended_market_language)
        context = self._build_followup_context(recommendation, pipeline, insights)
        history_lines = []
        for item in chat_history or []:
            role = "Usuario" if item.get("role") == "user" else "Asistente"
            content = (item.get("content") or "").strip()
            if content:
                history_lines.append(f"{role}: {content}")
        history_block = "\n".join(history_lines[-8:])
        user_content = context
        if history_block:
            user_content += f"\n\nHISTORIAL RECIENTE:\n{history_block}"
        user_content += f"\n\nPREGUNTA FOLLOW-UP:\n{question.strip()}"
        return self._call_text_model(prompt, user_content)

    def _format_context(self, pipeline, insights, filters: dict) -> str:
        """
        Serializa PipelineBreakdown + SegmentInsights en texto estructurado para el modelo.
        Usa secciones legibles, no JSON crudo.
        """
        market_language, market_tone = self._determine_market_guidance(filters)
        confidence, confidence_reason = self._deterministic_confidence(insights.sample_size)

        lines = ["=== ANALISIS DEL SEGMENTO ===", ""]
        lines.append(build_humand_brand_context(filters))
        lines.append("")
        lines.append("PARAMETROS DE SALIDA ESPERADOS:")
        lines.append(f"- Idioma de mercado recomendado: {market_language}")
        lines.append(f"- Tono de mercado recomendado: {market_tone}")
        lines.append(f"- Confianza deterministica esperada: {confidence}")
        lines.append(f"- Motivo de confianza: {confidence_reason}")
        lines.append(
            f"- Ventana temporal efectiva: {filters.get('start_date')} a {filters.get('end_date')}"
        )
        lines.append("")

        lines.append("FILTROS APLICADOS:")
        filter_labels = {
            "industry": "Industria",
            "country": "Pais",
            "region": "Region",
            "segment": "Segmento",
            "deal_stage": "Etapa",
            "start_date": "Desde",
            "end_date": "Hasta",
        }
        for key, label in filter_labels.items():
            val = filters.get(key)
            lines.append(f"- {label}: {self._format_filter_value(val) if val else 'Todos'}")
        lines.append("")

        lines.append("PIPELINE:")
        lines.append(f"- Total deals en segmento: {pipeline.total_deals}")
        lines.append(f"- Revenue total: ${pipeline.total_revenue:,.0f}")
        if pipeline.by_industry:
            top3 = pipeline.by_industry[:3]
            lines.append(
                "- Top industrias: "
                + ", ".join(
                    f"{r.get('industry', r.get('label', '?'))} ({r['deals']} deals)" for r in top3
                )
            )
        if pipeline.by_country:
            top3 = pipeline.by_country[:3]
            lines.append(
                "- Top paises: "
                + ", ".join(
                    f"{r.get('country', r.get('label', '?'))} ({r['deals']} deals)" for r in top3
                )
            )
        if pipeline.by_stage:
            stage_str = ", ".join(
                f"{r.get('stage', r.get('label', '?'))}: {r['deals']}" for r in pipeline.by_stage[:6]
            )
            lines.append(f"- Por etapa: {stage_str}")
        lines.append("")

        if insights.top_pains:
            lines.append(f"PAIN POINTS (top {len(insights.top_pains)} del segmento):")
            for i, pain in enumerate(insights.top_pains, 1):
                theme = f" [{pain.get('pain_theme', '')}]" if pain.get("pain_theme") else ""
                quote = (
                    f' | Quote: "{pain["example_quote"][:120]}..."'
                    if pain.get("example_quote")
                    else ""
                )
                lines.append(
                    f"{i}. {pain.get('subtype_display', '?')}{theme} - "
                    f"{pain.get('count', 0)} menciones en {pain.get('deal_count', '?')} deals{quote}"
                )
            lines.append("")

        if insights.insight_volume:
            lines.append("VOLUMEN DE INSIGHTS:")
            for insight_type, volume in sorted(insights.insight_volume.items()):
                lines.append(f"- {insight_type}: {volume}")
            lines.append("")

        if insights.top_faqs:
            lines.append(f"PREGUNTAS FRECUENTES (top {len(insights.top_faqs)}):")
            for i, faq in enumerate(insights.top_faqs, 1):
                lines.append(
                    f"{i}. {faq.get('subtype_display', '?')} - {faq.get('count', 0)} menciones"
                )
            lines.append("")

        if insights.top_modules:
            lines.append(f"MODULOS MAS SOLICITADOS (top {len(insights.top_modules)}):")
            for i, module in enumerate(insights.top_modules, 1):
                category = f" ({module.get('hr_category', '')})" if module.get("hr_category") else ""
                status = get_module_status_label(module.get("module_display"))
                status_part = f" [{status.upper()}]" if status else ""
                dealbreakers = (
                    f", {module['dealbreaker_count']} dealbreakers"
                    if module.get("dealbreaker_count")
                    else ""
                )
                lines.append(
                    f"{i}. {module.get('module_display', '?')}{category}{status_part} - "
                    f"{module.get('count', 0)} solicitudes{dealbreakers}"
                )
            lines.append("")

        if insights.competitors:
            lines.append("PANORAMA COMPETITIVO:")
            for competitor in insights.competitors:
                lines.append(
                    f"- {competitor.get('competitor_name', '?')} "
                    f"({competitor.get('relationship_display', '?')}): {competitor.get('count', 0)} menciones"
                )
            lines.append("")

        if insights.top_gaps:
            lines.append(f"FEATURE GAPS CRITICOS (top {len(insights.top_gaps)}):")
            for i, gap in enumerate(insights.top_gaps, 1):
                description = (
                    f" - {gap['example_description'][:80]}" if gap.get("example_description") else ""
                )
                lines.append(
                    f"{i}. {gap.get('feature_display', '?')} [{gap.get('priority', '?').upper()}] "
                    f"- {gap.get('count', 0)} menciones{description}"
                )
            lines.append("")

        lines.append(f"MUESTRA: {insights.sample_size} demos analizadas")

        return "\n".join(lines)

    def _build_system_prompt(self) -> str:
        """Construye el system prompt para OpenAI."""
        return """\
Eres un estratega de marketing B2B SaaS interno de Humand (humand.co), especializado en HR tech para mercados LATAM y EMEA.
Tu trabajo es analizar datos reales de demos de ventas y pipeline CRM para generar
recomendaciones de campana concretas y accionables.

TAREA:
Dado un analisis estructurado de un segmento de mercado, genera 2 o 3 angulos de campana
de marketing concreta, justificada exclusivamente con los datos del input.

CONTEXTOS QUE RECIBIRAS:
- Un bloque "CONTEXTO HUMAND (FIRST-PARTY)" con verdades de producto y posicionamiento de Humand
- Un bloque de evidencia del segmento con pipeline, pains, FAQs, modulos, competidores y gaps
- Un bloque de parametros esperados con idioma de mercado, tono recomendado, confianza deterministica y ventana temporal efectiva

COMO USAR CADA CONTEXTO:
- Usa el CONTEXTO HUMAND para entender quien es Humand, que modulos existen hoy, cuales son gaps conocidos y que competidores importan estrategicamente
- Usa la evidencia del segmento como UNICA base para claims de demanda, numeros, supporting_data y menciones competitivas del segmento
- Si un competidor aparece solo en el catalogo curado y no en la evidencia del segmento, NO digas que fue mencionado o evaluado en la muestra
- Si una necesidad depende de un modulo marcado como missing, NO lo promociones como capacidad nativa actual de Humand
- Si el segmento muestra demanda por algo missing, responde con transparencia: recomienda calificar upfront, explicitar el caveat o posicionar un angulo alternativo basado en fortalezas actuales de Humand
- El hero_message y el titulo deben enfocarse en pains validados + fortalezas actuales de Humand. Los gaps criticos deben ir a qualification_checks y, si hace falta, a la ultima parte del core_message, no al inicio del mensaje
- Nunca lideres el titulo o el hero con payroll, ATS u otro modulo missing. Si esos temas aparecen, tratalos como caveat, filtro de calificacion o validacion tecnica
- Usa el idioma de mercado recomendado para title, hero_message, core_message y content_ideas. Puedes mantener el resto del JSON en espanol interno si hace falta

RESTRICCIONES ESTRICTAS:
- Solo recomienda acciones respaldadas por MINIMO 2 data points del input
- Prioriza los pain points con mayor cantidad de menciones
- Si hay feature gaps con prioridad "dealbreaker", DEBEN aparecer en qualification_checks o en qualification_summary
- NO inventes problemas, personas o necesidades que no esten evidenciados en los datos
- Respeta la confianza deterministica esperada del input. No la subas
- Cada `supporting_data` DEBE citar numeros concretos del analisis
- Si la evidencia no alcanza para una recomendacion fuerte, reconoce la limitacion con honestidad
- Respeta estrictamente los filtros de region y ventana temporal ya aplicados en el input
- No hagas afirmaciones sobre mercados o segmentos fuera de la muestra recibida
- Devuelve angulos rankeados. El rank 1 es el mejor primer test, y los siguientes son opciones secundarias defendibles
- Los 2 o 3 angulos deben ser claramente distintos entre si; no reescribas el mismo angulo con palabras distintas

TIPOS DE ACCION PERMITIDOS:
content_campaign, webinar, case_study, email_sequence, landing_page, paid_ad, sales_enablement

FORMATO DE RESPUESTA:
Responde UNICAMENTE con un JSON valido que siga este schema exacto:
{
  "segment_summary": "2-3 oraciones describiendo lo mas relevante del segmento analizado",
  "recommended_market_language": "pt-BR|es-LATAM|es-ES|en-US|en-GB",
  "market_tone": "string",
  "confidence_reason": "string",
  "freshness_window": "string",
  "qualification_summary": ["string"],
  "recommended_angles": [
    {
      "rank": 1,
      "action_type": "string",
      "title": "string",
      "target_audience": "string",
      "hero_message": "string",
      "core_message": "string",
      "key_pain_addressed": "string",
      "supporting_data": "string",
      "qualification_checks": ["string"],
      "channels": ["string"],
      "content_ideas": ["string", "string"],
      "priority": "high",
      "launch_readiness": "ready_now|validate_first",
      "rationale": "string"
    }
  ],
  "what_not_to_do": ["string"],
  "data_confidence": "high|medium|low"
}

IMPORTANTE:
- recommended_angles debe contener 2 o 3 elementos
- Devuelve ranks consecutivos empezando en 1
- Para Brasil, escribe title / hero_message / core_message / content_ideas en pt-BR
- Para North America o EMEA en ingles, escribe title / hero_message / core_message / content_ideas en ingles
- Para LATAM hispanohablante, escribe title / hero_message / core_message / content_ideas en espanol del mercado
- No agregues markdown ni explicaciones fuera del JSON
"""

    def _build_translation_prompt(self, target_language: str) -> str:
        language_map = {
            "es": "español neutral de negocio",
            "en": "clear business English",
            "pt-BR": "português do Brasil",
        }
        destination = language_map.get(target_language, target_language)
        return f"""\
Eres un traductor senior de marketing B2B.
Traduce el contenido del JSON al idioma destino: {destination}.

REGLAS:
- Traduce de forma fiel, sin reinterpretar la estrategia.
- Conserva numeros, cantidades, nombres de modulos, nombre de Humand y nombres de competidores.
- No inventes ni elimines informacion.
- Mantene el mismo tono operativo y comercial.
- Devuelve UNICAMENTE JSON valido con el mismo schema pedido.
"""

    def _build_followup_prompt(self, target_language: str) -> str:
        language_map = {
            "es": "español",
            "en": "English",
            "pt-BR": "português do Brasil",
            "es-LATAM": "español",
            "es-ES": "español de España",
            "en-US": "English",
            "en-GB": "English",
        }
        destination = language_map.get(target_language, "español")
        return f"""\
Eres el advisor de marketing de Humand.
Tu trabajo es responder preguntas de seguimiento sobre un plan ya generado.

REGLAS:
- Responde solo con la evidencia disponible del plan y del segmento.
- No inventes nuevos segmentos, cifras ni claims.
- Si falta evidencia para responder, dilo de forma directa.
- Si la pregunta pide accion, responde de forma concreta y ejecutiva.
- Responde en {destination}.
- Usa markdown simple cuando ayude a la lectura.
"""

    def _response_schema(self) -> dict:
        """Schema JSON compartido para Structured Outputs."""
        return {
            "name": "marketing_recommendation",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "segment_summary": {"type": "string"},
                    "recommended_market_language": {"type": "string"},
                    "market_tone": {"type": "string"},
                    "confidence_reason": {"type": "string"},
                    "freshness_window": {"type": "string"},
                    "qualification_summary": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "recommended_angles": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "rank": {"type": "integer", "minimum": 1, "maximum": 3},
                                "action_type": {
                                    "type": "string",
                                    "enum": list(ALLOWED_ACTION_TYPES),
                                },
                                "title": {"type": "string"},
                                "target_audience": {"type": "string"},
                                "hero_message": {"type": "string"},
                                "core_message": {"type": "string"},
                                "key_pain_addressed": {"type": "string"},
                                "supporting_data": {"type": "string"},
                                "qualification_checks": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "channels": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "content_ideas": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "priority": {
                                    "type": "string",
                                    "enum": ["high", "medium", "low"],
                                },
                                "launch_readiness": {
                                    "type": "string",
                                    "enum": list(ALLOWED_LAUNCH_READINESS),
                                },
                                "rationale": {"type": "string"},
                            },
                            "required": [
                                "rank",
                                "action_type",
                                "title",
                                "target_audience",
                                "hero_message",
                                "core_message",
                                "key_pain_addressed",
                                "supporting_data",
                                "qualification_checks",
                                "channels",
                                "content_ideas",
                                "priority",
                                "launch_readiness",
                                "rationale",
                            ],
                        },
                    },
                    "what_not_to_do": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "data_confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                },
                "required": [
                    "segment_summary",
                    "recommended_market_language",
                    "market_tone",
                    "confidence_reason",
                    "freshness_window",
                    "qualification_summary",
                    "recommended_angles",
                    "what_not_to_do",
                    "data_confidence",
                ],
            },
        }

    def _translation_schema(self) -> dict:
        return {
            "name": "translated_marketing_recommendation",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "segment_summary": {"type": "string"},
                    "market_tone": {"type": "string"},
                    "confidence_reason": {"type": "string"},
                    "qualification_summary": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "recommended_angles": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "rank": {"type": "integer", "minimum": 1, "maximum": 3},
                                "title": {"type": "string"},
                                "target_audience": {"type": "string"},
                                "hero_message": {"type": "string"},
                                "core_message": {"type": "string"},
                                "key_pain_addressed": {"type": "string"},
                                "supporting_data": {"type": "string"},
                                "qualification_checks": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "content_ideas": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "rationale": {"type": "string"},
                            },
                            "required": [
                                "rank",
                                "title",
                                "target_audience",
                                "hero_message",
                                "core_message",
                                "key_pain_addressed",
                                "supporting_data",
                                "qualification_checks",
                                "content_ideas",
                                "rationale",
                            ],
                        },
                    },
                    "what_not_to_do": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "segment_summary",
                    "market_tone",
                    "confidence_reason",
                    "qualification_summary",
                    "recommended_angles",
                    "what_not_to_do",
                ],
            },
        }

    def _call_openai(self, context_text: str, question: str) -> str:
        """
        Llama a la API de OpenAI con el contexto y la pregunta.
        Reintenta una vez en caso de error transitorio.
        """
        user_content = context_text
        if question and question.strip():
            user_content += f"\n\nPREGUNTA ESPECIFICA DEL USUARIO: {question.strip()}"

        last_err = None
        for attempt in range(2):
            try:
                if hasattr(self.client, "responses") and hasattr(self.client.responses, "create"):
                    try:
                        response = self.client.responses.create(
                            model=self.model,
                            instructions=self._build_system_prompt(),
                            input=user_content,
                            max_output_tokens=2200,
                            text={"format": {"type": "json_schema", **self._response_schema()}},
                        )
                    except Exception:
                        response = self.client.responses.create(
                            model=self.model,
                            instructions=self._build_system_prompt(),
                            input=user_content,
                            max_output_tokens=2200,
                        )
                    return self._extract_response_text(response) or "{}"

                response = self.client.chat.completions.create(
                    model=self.model,
                    temperature=0.2,
                    response_format={
                        "type": "json_schema",
                        "json_schema": self._response_schema(),
                    },
                    max_tokens=2200,
                    messages=[
                        {"role": "system", "content": self._build_system_prompt()},
                        {"role": "user", "content": user_content},
                    ],
                )
                return response.choices[0].message.content or "{}"
            except Exception as exc:  # pragma: no cover - network/runtime
                last_err = exc
                if attempt == 0:
                    continue
        raise RuntimeError(f"Error al llamar a OpenAI: {last_err}") from last_err

    def _call_translation_model(self, payload: dict, target_language: str) -> str:
        user_content = json.dumps(payload, ensure_ascii=False)
        last_err = None
        for attempt in range(2):
            try:
                if hasattr(self.client, "responses") and hasattr(self.client.responses, "create"):
                    try:
                        response = self.client.responses.create(
                            model=self.model,
                            instructions=self._build_translation_prompt(target_language),
                            input=user_content,
                            max_output_tokens=2200,
                            text={"format": {"type": "json_schema", **self._translation_schema()}},
                        )
                    except Exception:
                        response = self.client.responses.create(
                            model=self.model,
                            instructions=self._build_translation_prompt(target_language),
                            input=user_content,
                            max_output_tokens=2200,
                        )
                    return self._extract_response_text(response) or "{}"

                response = self.client.chat.completions.create(
                    model=self.model,
                    temperature=0,
                    response_format={
                        "type": "json_schema",
                        "json_schema": self._translation_schema(),
                    },
                    max_tokens=2200,
                    messages=[
                        {"role": "system", "content": self._build_translation_prompt(target_language)},
                        {"role": "user", "content": user_content},
                    ],
                )
                return response.choices[0].message.content or "{}"
            except Exception as exc:  # pragma: no cover - network/runtime
                last_err = exc
                if attempt == 0:
                    continue
        raise RuntimeError(f"Error al traducir con OpenAI: {last_err}") from last_err

    def _call_text_model(self, instructions: str, user_content: str) -> str:
        last_err = None
        for attempt in range(2):
            try:
                if hasattr(self.client, "responses") and hasattr(self.client.responses, "create"):
                    response = self.client.responses.create(
                        model=self.model,
                        instructions=instructions,
                        input=user_content,
                        max_output_tokens=1200,
                    )
                    return self._extract_response_text(response) or ""

                response = self.client.chat.completions.create(
                    model=self.model,
                    temperature=0.2,
                    max_tokens=1200,
                    messages=[
                        {"role": "system", "content": instructions},
                        {"role": "user", "content": user_content},
                    ],
                )
                return response.choices[0].message.content or ""
            except Exception as exc:  # pragma: no cover - network/runtime
                last_err = exc
                if attempt == 0:
                    continue
        raise RuntimeError(f"Error al consultar follow-up con OpenAI: {last_err}") from last_err

    def _extract_response_text(self, response) -> str:
        """
        Compat helper para Responses API. Usa `output_text` si existe y,
        si no, intenta reconstruir el texto desde `output`.
        """
        output_text = getattr(response, "output_text", None)
        if output_text:
            return output_text

        output_parsed = getattr(response, "output_parsed", None)
        if output_parsed:
            try:
                return json.dumps(output_parsed, ensure_ascii=False)
            except Exception:
                pass

        fragments = []
        for item in getattr(response, "output", []) or []:
            for content in getattr(item, "content", []) or []:
                parsed = getattr(content, "parsed", None)
                if parsed:
                    try:
                        return json.dumps(parsed, ensure_ascii=False)
                    except Exception:
                        pass
                text = getattr(content, "text", None)
                if text:
                    fragments.append(text)
                arguments = getattr(content, "arguments", None)
                if arguments:
                    fragments.append(arguments)
        return "\n".join(fragments).strip()

    def _repair_response(self, raw_response: str) -> str:
        """
        Intenta reparar una salida JSON invalida usando un prompt de correccion.
        Si falla, devuelve la respuesta original.
        """
        if not hasattr(self.client, "chat") or not hasattr(self.client.chat, "completions"):
            return raw_response

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                temperature=0,
                response_format={
                    "type": "json_schema",
                    "json_schema": self._response_schema(),
                },
                max_tokens=2200,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Corrige el siguiente JSON para que cumpla exactamente el schema pedido. "
                            "No inventes nueva evidencia. Si falta un dato, usa el minimo texto posible "
                            "sin salir del contenido ya presente."
                        ),
                    },
                    {"role": "user", "content": raw_response},
                ],
            )
            return response.choices[0].message.content or raw_response
        except Exception:
            return raw_response

    def _parse_recommendation(
        self, raw: str, filters: dict, sample_size: int
    ) -> MarketingRecommendation:
        """
        Parsea la respuesta JSON del modelo.
        """
        data = self._coerce_json_data(raw)

        if data is None:
            return self._error_recommendation(
                filters,
                sample_size,
                "No se pudo parsear la respuesta de OpenAI. Probá de nuevo; si vuelve a pasar, revisamos el output crudo.",
            )

        try:
            payload = MarketingRecommendationPayload.model_validate(data)
        except ValidationError as exc:
            return self._error_recommendation(
                filters,
                sample_size,
                f"La respuesta de OpenAI no paso la validacion del schema: {exc.errors()[0]['msg']}",
            )

        angles = [
            CampaignAngle(
                rank=angle.rank,
                action_type=angle.action_type,
                title=angle.title,
                target_audience=angle.target_audience,
                hero_message=angle.hero_message,
                core_message=angle.core_message,
                key_pain_addressed=angle.key_pain_addressed,
                supporting_data=angle.supporting_data,
                qualification_checks=angle.qualification_checks,
                channels=angle.channels,
                content_ideas=angle.content_ideas,
                priority=angle.priority,
                launch_readiness=angle.launch_readiness,
                rationale=angle.rationale,
            )
            for angle in payload.recommended_angles
        ]
        angles.sort(key=lambda angle: angle.rank)

        expected_language, expected_tone = self._determine_market_guidance(filters)
        confidence, confidence_reason = self._deterministic_confidence(sample_size)
        freshness_window = f"{filters.get('start_date')} a {filters.get('end_date')}"

        return MarketingRecommendation(
            segment_summary=payload.segment_summary,
            recommended_market_language=expected_language,
            market_tone=expected_tone,
            confidence_reason=confidence_reason,
            freshness_window=freshness_window,
            qualification_summary=payload.qualification_summary,
            recommended_angles=angles,
            what_not_to_do=payload.what_not_to_do,
            data_confidence=confidence,
            sample_size=sample_size,
            filters_applied=filters,
        )

    def _coerce_json_data(self, raw: str):
        text = re.sub(r"```(?:json)?\s*", "", raw or "").strip().rstrip("`").strip()
        if not text:
            return None

        candidates: list[str] = [text]
        balanced = self._extract_balanced_json_object(text)
        if balanced and balanced not in candidates:
            candidates.append(balanced)

        broad_match = re.search(r"\{.*\}", text, re.DOTALL)
        if broad_match:
            broad_candidate = broad_match.group()
            if broad_candidate not in candidates:
                candidates.append(broad_candidate)

        for candidate in candidates:
            parsed = self._try_parse_candidate(candidate)
            if isinstance(parsed, str) and parsed.strip() != candidate.strip():
                nested = self._try_parse_candidate(parsed)
                if nested is not None:
                    return nested
            if parsed is not None:
                return parsed
        return None

    def _try_parse_candidate(self, candidate: str):
        normalized = (candidate or "").strip()
        if not normalized:
            return None

        try:
            return json.loads(normalized)
        except json.JSONDecodeError:
            pass

        without_trailing_commas = re.sub(r",(\s*[}\]])", r"\1", normalized)
        if without_trailing_commas != normalized:
            try:
                return json.loads(without_trailing_commas)
            except json.JSONDecodeError:
                pass

        try:
            parsed = ast.literal_eval(normalized)
            if isinstance(parsed, (dict, list, str)):
                return parsed
        except Exception:
            pass
        return None

    def _extract_balanced_json_object(self, text: str) -> str | None:
        start = text.find("{")
        if start == -1:
            return None

        depth = 0
        in_string = False
        escape_next = False
        for index in range(start, len(text)):
            char = text[index]
            if escape_next:
                escape_next = False
                continue
            if char == "\\":
                escape_next = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[start:index + 1]
        return None

    def _recommendation_translation_payload(self, recommendation: MarketingRecommendation) -> dict:
        return {
            "segment_summary": recommendation.segment_summary,
            "market_tone": recommendation.market_tone,
            "confidence_reason": recommendation.confidence_reason,
            "qualification_summary": recommendation.qualification_summary,
            "recommended_angles": [
                {
                    "rank": angle.rank,
                    "title": angle.title,
                    "target_audience": angle.target_audience,
                    "hero_message": angle.hero_message,
                    "core_message": angle.core_message,
                    "key_pain_addressed": angle.key_pain_addressed,
                    "supporting_data": angle.supporting_data,
                    "qualification_checks": angle.qualification_checks,
                    "content_ideas": angle.content_ideas,
                    "rationale": angle.rationale,
                }
                for angle in recommendation.recommended_angles
            ],
            "what_not_to_do": recommendation.what_not_to_do,
        }

    def _build_followup_context(self, recommendation: MarketingRecommendation, pipeline, insights) -> str:
        lines = ["PLAN ACTUAL:"]
        lines.append(f"- Resumen: {recommendation.segment_summary}")
        lines.append(f"- Idioma del plan: {recommendation.recommended_market_language}")
        lines.append(f"- Confianza: {recommendation.data_confidence}")
        lines.append(f"- Muestra: {recommendation.sample_size}")
        lines.append(f"- Ventana temporal: {recommendation.freshness_window}")
        if recommendation.qualification_summary:
            lines.append("- Validaciones previas:")
            lines.extend(f"  - {item}" for item in recommendation.qualification_summary[:6])
        lines.append("- Angulos:")
        for angle in recommendation.recommended_angles:
            lines.append(
                f"  - #{angle.rank} {angle.title} | Tipo: {angle.action_type} | Prioridad: {angle.priority}"
            )
            lines.append(f"    Hero: {angle.hero_message}")
            lines.append(f"    Mensaje: {angle.core_message}")
            if angle.qualification_checks:
                lines.append("    Chequeos:")
                lines.extend(f"      - {item}" for item in angle.qualification_checks[:4])

        lines.append("")
        lines.append("EVIDENCIA DEL SEGMENTO:")
        lines.append(f"- Deals: {getattr(pipeline, 'total_deals', 0)}")
        lines.append(f"- Revenue: {getattr(pipeline, 'total_revenue', 0):,.0f}")
        if getattr(insights, "top_pains", None):
            lines.append("- Top pains:")
            for item in insights.top_pains[:5]:
                lines.append(
                    f"  - {item.get('subtype_display', '?')}: {item.get('count', 0)} menciones en {item.get('deal_count', 0)} deals"
                )
        if getattr(insights, "top_faqs", None):
            lines.append("- Top FAQs:")
            for item in insights.top_faqs[:5]:
                lines.append(f"  - {item.get('subtype_display', '?')}: {item.get('count', 0)}")
        if getattr(insights, "top_modules", None):
            lines.append("- Top modulos:")
            for item in insights.top_modules[:6]:
                lines.append(f"  - {item.get('module_display', '?')}: {item.get('count', 0)}")
        if getattr(insights, "top_gaps", None):
            lines.append("- Top gaps:")
            for item in insights.top_gaps[:6]:
                lines.append(
                    f"  - {item.get('feature_display', '?')} [{item.get('priority', '?')}]: {item.get('count', 0)}"
                )
        if getattr(insights, "competitors", None):
            lines.append("- Competidores observados:")
            for item in insights.competitors[:6]:
                lines.append(f"  - {item.get('competitor_name', '?')}: {item.get('count', 0)}")
        return "\n".join(lines)

    def _parse_translated_recommendation(
        self,
        raw: str,
        base_recommendation: MarketingRecommendation,
        target_language: str,
    ) -> MarketingRecommendation:
        text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
        try:
            payload = TranslatedRecommendationPayload.model_validate(json.loads(text))
        except Exception as exc:
            raise RuntimeError(f"No se pudo traducir la recomendacion: {exc}") from exc

        translated_angles_by_rank = {angle.rank: angle for angle in payload.recommended_angles}
        translated_angles = []
        for angle in base_recommendation.recommended_angles:
            translated = translated_angles_by_rank.get(angle.rank)
            if not translated:
                translated_angles.append(angle)
                continue
            translated_angles.append(
                CampaignAngle(
                    rank=angle.rank,
                    action_type=angle.action_type,
                    title=translated.title,
                    target_audience=translated.target_audience,
                    hero_message=translated.hero_message,
                    core_message=translated.core_message,
                    key_pain_addressed=translated.key_pain_addressed,
                    supporting_data=translated.supporting_data,
                    qualification_checks=translated.qualification_checks,
                    channels=angle.channels,
                    content_ideas=translated.content_ideas,
                    priority=angle.priority,
                    launch_readiness=angle.launch_readiness,
                    rationale=translated.rationale,
                )
            )

        return MarketingRecommendation(
            segment_summary=payload.segment_summary,
            recommended_market_language=target_language,
            market_tone=payload.market_tone,
            confidence_reason=payload.confidence_reason,
            freshness_window=base_recommendation.freshness_window,
            qualification_summary=payload.qualification_summary,
            recommended_angles=translated_angles,
            what_not_to_do=payload.what_not_to_do,
            data_confidence=base_recommendation.data_confidence,
            sample_size=base_recommendation.sample_size,
            filters_applied=base_recommendation.filters_applied,
            model_used=base_recommendation.model_used,
        )

    def _error_recommendation(
        self, filters: dict, sample_size: int, error_msg: str
    ) -> MarketingRecommendation:
        """Retorna un MarketingRecommendation de error para manejo seguro en la UI."""
        return MarketingRecommendation(
            segment_summary=error_msg,
            recommended_market_language="",
            market_tone="",
            confidence_reason="",
            freshness_window="",
            qualification_summary=[],
            recommended_angles=[],
            what_not_to_do=[],
            data_confidence="low",
            sample_size=sample_size,
            filters_applied=filters,
            error=error_msg,
        )
