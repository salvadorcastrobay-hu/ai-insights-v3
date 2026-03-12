import pandas as pd
import streamlit as st


st.header("Glosario y Metodología")
st.caption("Definiciones rápidas para interpretar correctamente variables, indicadores y análisis.")

st.subheader("1) Cómo funciona")
st.markdown(
    """
    El flujo de AI Sales Insights sigue esta lógica:

    1. **Ingesta de fuentes**: se toman transcripts de llamadas y datos comerciales del CRM.
    2. **Enriquecimiento**: se cruzan señales de conversación con contexto de deal (owner, etapa, monto, segmento, país).
    3. **Normalización**: el contenido libre se clasifica usando una taxonomía común (tipos de insight, subtipos, módulos, competencia).
    4. **Extracción de insights**: una llamada puede generar uno o varios insights, cada uno con su tipo y atributos.
    5. **Consolidación**: todo queda estructurado en tablas/vistas para análisis y filtros.
    6. **Visualización**: dashboards y chat consultan ese dataset para responder preguntas y mostrar tendencias.
    """
)

with st.expander("Qué significa esto para el usuario"):
    st.markdown(
        """
        - Los gráficos no muestran texto crudo: muestran **insights ya clasificados**.
        - Los filtros del sidebar cambian el universo analizado en tiempo real.
        - El mismo deal puede aparecer en varios insights porque una llamada puede tener múltiples señales.
        - Los KPIs dependen del recorte activo (filtros + rango de fechas).
        """
    )

st.subheader("2) Tipos de Insight")
st.markdown(
    "Cada insight extraído de una llamada se clasifica en **uno** de estos 5 tipos."
)
insight_types = pd.DataFrame(
    [
        {
            "Tipo": "Dolor / Problema",
            "Código": "pain",
            "Qué significa": "El prospecto describe un problema, frustración o necesidad actual.",
            "Ejemplo": "Procesos manuales, herramientas fragmentadas, falta de autogestión.",
        },
        {
            "Tipo": "Feature Faltante",
            "Código": "product_gap",
            "Qué significa": "Se pide una funcionalidad que no existe o no alcanza.",
            "Ejemplo": "Módulo de nómina, ATS, integración específica.",
        },
        {
            "Tipo": "Señal Competitiva",
            "Código": "competitive_signal",
            "Qué significa": "Se menciona un competidor en contexto comercial.",
            "Ejemplo": "Lo usan hoy, lo están evaluando o están migrando.",
        },
        {
            "Tipo": "Fricción del Deal",
            "Código": "deal_friction",
            "Qué significa": "Bloqueos que frenan el avance del deal.",
            "Ejemplo": "Budget, legal/compliance, seguridad, falta de decisor.",
        },
        {
            "Tipo": "Pregunta Frecuente",
            "Código": "faq",
            "Qué significa": "Pregunta recurrente del prospecto sobre producto/servicio.",
            "Ejemplo": "Precios, implementación, seguridad, integraciones.",
        },
    ]
)
st.dataframe(insight_types, width="stretch", hide_index=True)


st.subheader("3) Indicadores del Executive Summary")
kpi_df = pd.DataFrame(
    [
        {
            "Indicador": "Total Insights",
            "Cómo se calcula": "Cantidad total de insights en el dataset filtrado.",
            "Lectura recomendada": "Muestra el volumen total analizado.",
        },
        {
            "Indicador": "Transcripts",
            "Cómo se calcula": "Cantidad de transcript_id únicos.",
            "Lectura recomendada": "Mide cobertura de conversaciones analizadas.",
        },
        {
            "Indicador": "Deals con Match",
            "Cómo se calcula": "Cantidad de deal_id únicos no nulos.",
            "Lectura recomendada": "Cuántos deals tienen señales enlazadas.",
        },
        {
            "Indicador": "Revenue Total",
            "Cómo se calcula": "Suma de amount por deal_id único.",
            "Lectura recomendada": "Magnitud económica aproximada del universo analizado.",
        },
        {
            "Indicador": "Competidores Únicos",
            "Cómo se calcula": "Cantidad de competitor_name únicos no nulos.",
            "Lectura recomendada": "Diversidad competitiva detectada en llamadas.",
        },
    ]
)
st.dataframe(kpi_df, width="stretch", hide_index=True)


st.subheader("4) Cómo leer gráficos de Custom Dashboards")
chart_terms = pd.DataFrame(
    [
        {
            "Campo": "Eje X",
            "Definición": "Dimensión principal (ej: Región, Tipo de insight, Módulo).",
            "Tip": "Elegí una variable categórica cuando quieras comparar grupos.",
        },
        {
            "Campo": "Columna Y",
            "Definición": "Métrica a calcular/mostrar en el eje vertical.",
            "Tip": "Para suma/promedio/mediana usá métricas numéricas (Revenue, Confianza).",
        },
        {
            "Campo": "Color por",
            "Definición": "Segmenta cada barra/línea por otra dimensión.",
            "Tip": "Sirve para comparar cortes dentro del mismo gráfico (ej: por segmento).",
        },
        {
            "Campo": "Agregación",
            "Definición": "Regla para calcular el valor del gráfico.",
            "Tip": "Conteo, Suma, Promedio, Mediana o Conteo distinto según la pregunta.",
        },
        {
            "Campo": "Top N",
            "Definición": "Limita a las N categorías más relevantes.",
            "Tip": "Útil para rankings legibles; evita gráficos sobrecargados.",
        },
    ]
)
st.dataframe(chart_terms, width="stretch", hide_index=True)

with st.expander("Ver detalle de agregaciones"):
    aggs = pd.DataFrame(
        [
            {
                "Agregación": "Conteo de insights",
                "Qué hace": "Cuenta filas/insights por grupo.",
                "Cuándo usarla": "Para volumen y frecuencia.",
            },
            {
                "Agregación": "Suma",
                "Qué hace": "Suma una métrica numérica por grupo.",
                "Cuándo usarla": "Para revenue acumulado u otros totales.",
            },
            {
                "Agregación": "Promedio",
                "Qué hace": "Promedio de una métrica numérica por grupo.",
                "Cuándo usarla": "Para comparar niveles medios.",
            },
            {
                "Agregación": "Mediana",
                "Qué hace": "Valor central de una métrica numérica por grupo.",
                "Cuándo usarla": "Cuando hay valores extremos que sesgan el promedio.",
            },
            {
                "Agregación": "Conteo distinto",
                "Qué hace": "Cuenta valores únicos de una columna por grupo.",
                "Cuándo usarla": "Para contar deals únicos, empresas únicas, etc.",
            },
        ]
    )
    st.dataframe(aggs, width="stretch", hide_index=True)


st.subheader("5) Diccionario corto de variables")
var_df = pd.DataFrame(
    [
        {"Variable": "region", "Significado": "Región comercial/geográfica del deal."},
        {"Variable": "country", "Significado": "País asociado al deal o la conversación."},
        {"Variable": "segment", "Significado": "Segmento comercial (ej: SMB, Mid-Market, Enterprise)."},
        {"Variable": "deal_owner", "Significado": "AE responsable del deal."},
        {"Variable": "module_display", "Significado": "Módulo de Humand asociado al insight."},
        {"Variable": "hr_category_display", "Significado": "Categoría HR del módulo."},
        {"Variable": "insight_subtype_display", "Significado": "Subtipo dentro del tipo de insight."},
        {"Variable": "pain_theme", "Significado": "Tema macro del pain (procesos, tecnología, etc.)."},
        {"Variable": "gap_priority", "Significado": "Urgencia del gap: debe tener, deseable o bloqueante."},
        {"Variable": "competitor_relationship_display", "Significado": "Relación con competidor (usa, evalúa, migra, etc.)."},
        {"Variable": "call_date", "Significado": "Fecha de la llamada analizada."},
        {"Variable": "confidence", "Significado": "Confianza del modelo para ese insight (0 a 1)."},
        {"Variable": "amount", "Significado": "Monto del deal usado para análisis de revenue."},
    ]
)
st.dataframe(var_df, width="stretch", hide_index=True)
