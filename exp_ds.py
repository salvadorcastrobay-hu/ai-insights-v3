"""
Shared design system infrastructure for all Experimental pages.
Import this at the top of every exp_*.py file.
"""
from __future__ import annotations
import streamlit as st
import plotly.graph_objects as go

DS = {
    "text_default":    "#303036",
    "text_secondary":  "#636271",
    "brand_400":       "#6f93eb",
    "brand_500":       "#496be3",
    "brand_100":       "#dee5fb",
    "brand_50":        "#f1f4fd",
    "bg_page":         "#f5f6f8",
    "bg_card":         "#ffffff",
    "neutral_100":     "#eeeef1",
    "neutral_200":     "#dfe0e6",
    "blueprimary_100": "#eff2ff",
    "blueprimary_800": "#213478",
    "palette": [
        "#6f93eb", "#496be3", "#9785ff", "#4bb69f",
        "#f4c83f", "#ed774a", "#6fd1e7", "#81de38",
        "#ea718b", "#d574c9",
    ],
    "shadow_4dp":  "-1px 4px 8px 0px rgba(233,233,244,1)",
    "shadow_8dp":  "-1px 8px 16px 0px rgba(170,170,186,0.45)",
    "font":        "Roboto, sans-serif",
    "size_xxxs":   "10px",
    "size_xxs":    "12px",
    "size_xs":     "14px",
    "size_s":      "16px",
    "size_m":      "18px",
    "size_l":      "24px",
    "size_xl":     "32px",
    "radius_s":    "4px",
    "radius_m":    "8px",
    "radius_l":    "16px",
}

# Brand heatmap scale
BRAND_SCALE = [[0, DS["brand_50"]], [0.5, DS["brand_400"]], [1.0, DS["blueprimary_800"]]]


def inject_ds_css() -> None:
    st.markdown(
        f"""
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;600&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=block');

        /* ── Page & app shell ── */
        html, body, [data-testid="stAppViewContainer"], [data-testid="stApp"] {{
            background-color: {DS['bg_page']} !important;
            color: {DS['text_default']} !important;
        }}
        /* ── Expander arrow icon fix ──
           Hide the broken "_arrow_right" icon element entirely, then inject the correct
           icon via ::before on the summary container so it appears BEFORE the label text. ── */
        [data-testid="stExpander"] summary [data-testid="stIconMaterial"] {{
            display: none !important;
        }}
        [data-testid="stExpander"] summary > * {{
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 8px !important;
        }}
        [data-testid="stExpander"] summary > *::before {{
            content: "chevron_right";
            font-family: "Material Symbols Rounded" !important;
            font-size: 20px !important;
            font-feature-settings: 'liga' 1 !important;
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24 !important;
            color: {DS['text_secondary']} !important;
            line-height: 1 !important;
            flex-shrink: 0;
        }}
        [data-testid="stExpander"] details[open] summary > *::before {{
            content: "expand_more";
        }}

        /* ── Sidebar — forced light, NO wildcard font override ── */
        [data-testid="stSidebar"] {{
            background-color: {DS['bg_card']} !important;
        }}
        /* Only target text nodes in sidebar, never icons */
        [data-testid="stSidebarNav"] a span:not([class*="material"]),
        [data-testid="stSidebarNav"] li span:not([class*="material"]),
        [data-testid="stSidebarUserContent"] p,
        [data-testid="stSidebarUserContent"] span:not([class*="material"]),
        [data-testid="stSidebarUserContent"] label {{
            color: {DS['text_default']} !important;
            font-family: {DS['font']} !important;
        }}
        [data-testid="stSidebarNav"] a {{
            font-size: {DS['size_xs']} !important;
            color: {DS['text_default']} !important;
        }}
        [data-testid="stSidebarNav"] a:hover {{
            color: {DS['brand_500']} !important;
            background-color: {DS['brand_50']} !important;
            border-radius: {DS['radius_s']};
        }}
        [aria-current="page"] {{
            color: {DS['brand_500']} !important;
            font-weight: 600 !important;
            background-color: {DS['blueprimary_100']} !important;
            border-radius: {DS['radius_s']};
        }}

        /* ── Typography — targeted, not global div ── */
        h1, h2, h3, h4, h5, h6 {{
            font-family: {DS['font']} !important;
            font-weight: 600 !important;
            color: {DS['text_default']} !important;
            letter-spacing: 0.2px;
        }}
        h1 {{ font-size: {DS['size_xl']} !important; line-height: 1.3; }}
        h2 {{ font-size: {DS['size_l']} !important;  line-height: 1.4; }}
        h3 {{ font-size: {DS['size_m']} !important;  line-height: 1.4; }}
        /* Scope Roboto to leaf text elements only — never span (would hit icon spans) */
        [data-testid="stMarkdownContainer"] p,
        [data-testid="stMarkdownContainer"] label,
        [data-testid="stText"] p,
        [data-testid="stCaptionContainer"] p,
        [data-testid="stMetricLabel"] p,
        [data-testid="stMetricValue"],
        [data-testid="stWidgetLabel"] label {{
            font-family: {DS['font']} !important;
            font-size: {DS['size_xs']} !important;
            line-height: 1.4;
            letter-spacing: 0.2px;
            color: {DS['text_default']} !important;
        }}

        /* ── Custom section headers ── */
        .ds-section-header {{
            font-family: {DS['font']};
            font-size: {DS['size_l']};
            font-weight: 600;
            color: {DS['text_default']};
            margin-top: 32px;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 2px solid {DS['brand_400']};
            letter-spacing: 0.2px;
        }}
        .ds-section-sub {{
            font-family: {DS['font']};
            font-size: {DS['size_m']};
            font-weight: 600;
            color: {DS['text_default']};
            margin-top: 24px;
            margin-bottom: 4px;
            letter-spacing: 0.2px;
        }}

        /* ── KPI metrics ── */
        [data-testid="stMetric"] {{
            background: {DS['bg_card']} !important;
            border-radius: {DS['radius_m']};
            box-shadow: {DS['shadow_4dp']};
            padding: 16px 20px !important;
        }}
        [data-testid="stMetricLabel"] p {{
            font-size: {DS['size_xxs']} !important;
            color: {DS['text_secondary']} !important;
            font-weight: 400 !important;
        }}
        [data-testid="stMetricValue"] {{
            font-size: {DS['size_xl']} !important;
            font-weight: 600 !important;
            color: {DS['text_default']} !important;
        }}
        [data-testid="stMetricDelta"] {{
            font-size: {DS['size_xxs']} !important;
            font-weight: 600 !important;
        }}
        [data-testid="stCaptionContainer"] p {{
            font-size: {DS['size_xxs']} !important;
            color: {DS['text_secondary']} !important;
            margin-top: 4px;
        }}

        /* ── Multiselect & select inputs ── */
        [data-baseweb="select"] > div {{
            background-color: {DS['bg_card']} !important;
            border-color: {DS['neutral_200']} !important;
            border-radius: {DS['radius_s']} !important;
        }}
        [data-baseweb="select"] > div:focus-within {{
            border-color: {DS['brand_400']} !important;
            box-shadow: 0 0 0 2px {DS['brand_100']} !important;
        }}
        /* Multiselect tags — brand blue instead of red */
        [data-baseweb="tag"] {{
            background-color: {DS['brand_100']} !important;
            border-radius: {DS['radius_s']} !important;
        }}
        [data-baseweb="tag"] span {{
            color: {DS['blueprimary_800']} !important;
            font-family: {DS['font']} !important;
            font-size: {DS['size_xxs']} !important;
            font-weight: 600 !important;
        }}
        [data-baseweb="tag"] [role="presentation"] {{
            color: {DS['blueprimary_800']} !important;
        }}
        /* Dropdown options */
        [data-baseweb="menu"] li {{
            font-family: {DS['font']} !important;
            font-size: {DS['size_xs']} !important;
            color: {DS['text_default']} !important;
        }}
        [data-baseweb="menu"] li:hover {{
            background-color: {DS['brand_50']} !important;
        }}
        /* Select input text */
        [data-baseweb="select"] input, [data-baseweb="select"] [data-testid="stSelectbox"] {{
            font-family: {DS['font']} !important;
            color: {DS['text_default']} !important;
        }}

        /* ── Date input ── */
        [data-testid="stDateInput"] input {{
            background-color: {DS['bg_card']} !important;
            border-color: {DS['neutral_200']} !important;
            border-radius: {DS['radius_s']} !important;
            color: {DS['text_default']} !important;
            font-family: {DS['font']} !important;
        }}

        /* ── Text input (search) ── */
        [data-testid="stTextInput"] input {{
            background-color: {DS['bg_card']} !important;
            border-color: {DS['neutral_200']} !important;
            border-radius: {DS['radius_s']} !important;
            color: {DS['text_default']} !important;
            font-family: {DS['font']} !important;
        }}
        [data-testid="stTextInput"] input:focus {{
            border-color: {DS['brand_400']} !important;
            box-shadow: 0 0 0 2px {DS['brand_100']} !important;
        }}

        /* ── Expander ── */
        [data-testid="stExpander"] {{
            background: {DS['bg_card']} !important;
            border-radius: {DS['radius_m']};
            border: 1px solid {DS['neutral_200']} !important;
            box-shadow: none;
        }}
        [data-testid="stExpander"] summary {{
            color: {DS['text_default']} !important;
            font-family: {DS['font']} !important;
            font-size: {DS['size_xs']} !important;
        }}
        /* Fix icon text rendering — keep icon fonts intact */
        [data-testid="stExpander"] summary svg,
        [data-testid="stExpander"] summary [data-testid="stIconMaterial"] {{
            font-family: "Material Icons", "Material Symbols Outlined" !important;
            font-size: 18px !important;
        }}

        /* ── Charts — overflow:visible so toolbar is never clipped ── */
        [data-testid="stPlotlyChart"] {{
            overflow: visible !important;
            border-radius: {DS['radius_m']};
            box-shadow: {DS['shadow_4dp']};
            padding: 8px;
            background: {DS['bg_card']} !important;
        }}
        [data-testid="stPlotlyChart"] > div {{
            border-radius: {DS['radius_m']};
            overflow: hidden;
        }}

        /* ── Dataframes — force light mode on canvas renderer ── */
        [data-testid="stDataFrame"],
        [data-testid="stDataEditor"] {{
            color-scheme: light !important;
            border-radius: {DS['radius_m']};
            box-shadow: {DS['shadow_4dp']};
            overflow: hidden;
        }}
        [data-testid="stDataFrame"] > div,
        [data-testid="stDataEditor"] > div {{
            background-color: {DS['bg_card']} !important;
            color-scheme: light !important;
        }}
        /* Column headers */
        [data-testid="stDataFrame"] [role="columnheader"],
        [data-testid="stDataFrame"] th {{
            background-color: {DS['blueprimary_100']} !important;
            color: {DS['blueprimary_800']} !important;
            font-family: {DS['font']} !important;
            font-size: {DS['size_xxs']} !important;
            font-weight: 600 !important;
        }}
        /* Table cells */
        [data-testid="stDataFrame"] [role="gridcell"],
        [data-testid="stDataFrame"] td {{
            background-color: {DS['bg_card']} !important;
            color: {DS['text_default']} !important;
            font-family: {DS['font']} !important;
            font-size: {DS['size_xxs']} !important;
        }}

        /* ── Alerts / info banners ── */
        [data-testid="stAlert"] {{
            border-radius: {DS['radius_m']};
            font-size: {DS['size_xs']};
            background-color: {DS['blueprimary_100']} !important;
            color: {DS['blueprimary_800']} !important;
            border-left: 3px solid {DS['brand_400']};
        }}

        /* ── Divider ── */
        hr {{
            border-color: {DS['neutral_200']} !important;
        }}

        /* ── KPI metric cards — equal height ── */
        [data-testid="stMetric"] {{
            min-height: 110px !important;
        }}

        /* ── Buttons — always white text (target span inside button too) ── */
        [data-testid="stButton"] button,
        [data-testid="stBaseButton-secondary"],
        [data-testid="stBaseButton-primary"],
        [data-testid="stSidebarUserContent"] button,
        [data-testid="stSidebarUserContent"] button span,
        [data-testid="stSidebarUserContent"] button p {{
            color: white !important;
        }}
        [data-testid="stButton"] button {{
            background-color: {DS['brand_400']} !important;
            border: none !important;
            border-radius: {DS['radius_s']} !important;
            font-family: {DS['font']} !important;
            font-size: {DS['size_xs']} !important;
            font-weight: 600 !important;
        }}
        [data-testid="stButton"] button:hover {{
            background-color: {DS['brand_500']} !important;
            box-shadow: {DS['shadow_8dp']};
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def ds_section(title: str) -> None:
    st.markdown(f'<div class="ds-section-header">{title}</div>', unsafe_allow_html=True)


def ds_sub(title: str) -> None:
    st.markdown(f'<div class="ds-section-sub">{title}</div>', unsafe_allow_html=True)


def apply_ds_layout(fig, title: str = "", height: int | None = None) -> go.Figure:
    updates: dict = dict(
        font=dict(family=DS["font"], color=DS["text_default"], size=12),
        title=dict(
            text=title,
            font=dict(family=DS["font"], size=14, color=DS["text_default"]),
            x=0,
            pad=dict(l=4),
        ),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=48, b=24, l=8, r=8),
        xaxis=dict(
            gridcolor=DS["neutral_100"],
            linecolor=DS["neutral_200"],
            tickfont=dict(family=DS["font"], size=11, color=DS["text_secondary"]),
        ),
        yaxis=dict(
            gridcolor=DS["neutral_100"],
            linecolor=DS["neutral_200"],
            tickfont=dict(family=DS["font"], size=11, color=DS["text_secondary"]),
        ),
        legend=dict(
            font=dict(family=DS["font"], size=11, color=DS["text_secondary"]),
            bgcolor="rgba(0,0,0,0)",
        ),
    )
    if height:
        updates["height"] = height
    fig.update_layout(**updates)
    return fig
