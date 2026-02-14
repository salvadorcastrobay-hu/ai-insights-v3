"""
Streamlit dashboard for Humand Sales Insights.

Run: streamlit run dashboard.py
Deploy: Streamlit Community Cloud (free)
"""

from __future__ import annotations

import streamlit as st
import streamlit_authenticator as stauth
from shared import load_auth_config, save_auth_config, load_data, render_sidebar

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

# ── Navigation (must always run to suppress pages/ auto-detection) ──

if not st.session_state.get("authentication_status"):
    # Not logged in: show a blank page so the sidebar stays clean
    nav = st.navigation([st.Page(lambda: None, title="Login", icon="🔒")])
    nav.run()
    st.stop()

pages = {
    "Dashboards": [
        st.Page("pages/executive_summary.py", title="Executive Summary", icon="📊", default=True),
        st.Page("pages/product_intelligence.py", title="Product Intelligence", icon="🧩"),
        st.Page("pages/competitive_intelligence.py", title="Competitive Intelligence", icon="⚔️"),
        st.Page("pages/sales_enablement.py", title="Sales Enablement", icon="🎯"),
        st.Page("pages/regional_gtm.py", title="Regional / GTM", icon="🌎"),
    ],
    "Detalle": [
        st.Page("pages/pains_detail.py", title="Pains", icon="🔍"),
        st.Page("pages/product_gaps_detail.py", title="Product Gaps", icon="🔍"),
        st.Page("pages/faq_detail.py", title="FAQs", icon="🔍"),
    ],
    "Herramientas": [
        st.Page("pages/sql_chat.py", title="Chat con IA", icon="🤖"),
    ],
}

nav = st.navigation(pages)

# ── Load data & sidebar filters ──

df = load_data()
st.session_state["df"] = df

if nav.title != "Chat con IA":
    filtered_df = render_sidebar(df)
else:
    filtered_df = df

st.session_state["filtered_df"] = filtered_df

# ── Run selected page ──

nav.run()

# ── Footer ──

st.sidebar.markdown("---")
if not df.empty and nav.title != "Chat con IA":
    st.sidebar.caption(f"{len(filtered_df)}/{len(df)} insights mostrados")
with st.sidebar:
    st.write(f"**{st.session_state.get('name')}**")
    authenticator.logout("Cerrar sesion")
