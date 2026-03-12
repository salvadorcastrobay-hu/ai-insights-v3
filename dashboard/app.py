"""
Streamlit dashboard for Humand Sales Insights.

Run: streamlit run dashboard/app.py
Deploy: Streamlit Community Cloud (free)
"""

from __future__ import annotations

import os
import sys

# Ensure dashboard/ is on sys.path for shared imports, and project root for src imports
_DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_DASHBOARD_DIR)
if _DASHBOARD_DIR not in sys.path:
    sys.path.insert(0, _DASHBOARD_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import pandas as pd
import streamlit as st
import streamlit_authenticator as stauth
from shared import load_auth_config, save_auth_config, load_data

# ── Page config (must be first Streamlit call) ──

st.set_page_config(
    page_title="Humand Sales Insights",
    page_icon="📊",
    layout="wide",
)

# ── Auth ──

config = load_auth_config()

authenticator = stauth.Authenticate(
    config["credentials"],
    config["cookie"]["name"],
    config["cookie"]["key"],
    config["cookie"]["expiry_days"],
    auto_hash=False,
)

try:
    authenticator.login()
except Exception as e:
    st.error(e)

if st.session_state.get("authentication_status") is False:
    st.error("Usuario o contrasena incorrectos.")
elif st.session_state.get("authentication_status") is None:
    st.info("Ingresa tu usuario y contrasena para acceder.")

try:
    save_auth_config(config)
except OSError:
    pass  # Read-only filesystem (Streamlit Cloud)

# ── Auth gate ──

if not st.session_state.get("authentication_status"):
    st.stop()

# ── Navigation (views/ dir avoids Streamlit auto-detection) ──

_views = os.path.join(_DASHBOARD_DIR, "views")

pages = {
    "Dashboards": [
        st.Page(os.path.join(_views, "executive_summary.py"), title="Executive Summary", icon="📊", default=True),
        st.Page(os.path.join(_views, "product_intelligence.py"), title="Product Intelligence", icon="🧩"),
        st.Page(os.path.join(_views, "competitive_intelligence.py"), title="Competitive Intelligence", icon="⚔️"),
        st.Page(os.path.join(_views, "sales_enablement.py"), title="Sales Enablement", icon="🎯"),
        st.Page(os.path.join(_views, "regional_gtm.py"), title="Regional / GTM", icon="🌎"),
    ],
    "Detalle": [
        st.Page(os.path.join(_views, "pains_detail.py"), title="Pains", icon="🔍"),
        st.Page(os.path.join(_views, "product_gaps_detail.py"), title="Product Gaps", icon="🔍"),
        st.Page(os.path.join(_views, "faq_detail.py"), title="FAQs", icon="🔍"),
    ],
    "Herramientas": [
        st.Page(os.path.join(_views, "sql_chat.py"), title="Chat con IA", icon="🤖"),
        st.Page(os.path.join(_views, "custom_dashboards.py"), title="Dashboards Personalizados", icon="📈"),
        st.Page(os.path.join(_views, "glossary.py"), title="Ayuda y Taxonomía", icon="📘"),
    ],
}

nav = st.navigation(pages)

# ── Load data & sidebar filters ──

pages_with_data = {
    "Executive Summary",
    "Product Intelligence",
    "Competitive Intelligence",
    "Sales Enablement",
    "Regional / GTM",
    "Pains",
    "Product Gaps",
    "FAQs",
    "Dashboards Personalizados",
}
needs_data = nav.title in pages_with_data

if needs_data:
    with st.spinner("Cargando datos..."):
        df = load_data()
    st.session_state["df"] = df
else:
    df = st.session_state.get("df", pd.DataFrame())

# Each page renders its own inline filters — store unfiltered df as filtered_df
# so custom_dashboards and legacy reads still work
st.session_state["filtered_df"] = df

# ── Run selected page ──

nav.run()

# ── Footer ──

st.sidebar.markdown("---")
with st.sidebar:
    st.write(f"**{st.session_state.get('name')}**")
    authenticator.logout("Cerrar sesion")

if not st.session_state.get("authentication_status"):
    st.cache_data.clear()
    st.rerun()
