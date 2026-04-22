"""
Streamlit dashboard for Humand Sales Insights.

Run: streamlit run dashboard.py
Deploy: Streamlit Community Cloud (free)
"""

from __future__ import annotations

import inspect
import pandas as pd
import shared as shared_module
import streamlit as st
import streamlit_authenticator as stauth
from shared import (
    get_dashboard_data_version,
    get_dashboard_prompt_version,
    initialize_global_filters,
    load_auth_config,
    load_data,
    save_auth_config,
)

# ── Page config (must be first Streamlit call) ──

st.set_page_config(
    page_title="Humand Sales Insights",
    page_icon="📊",
    layout="wide",
)

def _apply_sidebar_layout(page_title: str) -> None:
    is_campaign_advisor = page_title == "Campaign Advisor"
    sidebar_height = "auto" if is_campaign_advisor else "100vh"
    sidebar_max_height = "100vh" if is_campaign_advisor else "100vh"
    content_overflow_y = "auto" if is_campaign_advisor else "hidden"
    st.markdown(
        f"""
        <style>
        [data-testid="stSidebar"] {{
            height: {sidebar_height};
            max-height: {sidebar_max_height};
            overflow-y: {content_overflow_y};
        }}

        [data-testid="stSidebar"] > div:first-child {{
            height: {sidebar_height};
            max-height: {sidebar_max_height};
        }}

        [data-testid="stSidebarContent"] {{
            height: {sidebar_height};
            max-height: {sidebar_max_height};
            overflow-y: {content_overflow_y};
            overflow-x: visible;
        }}
        </style>
        """,
        unsafe_allow_html=True,
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

# ── Role check (admin = acceso a features experimentales) ──

current_user = st.session_state.get("username", "")
user_roles = config["credentials"]["usernames"].get(current_user, {}).get("roles", [])
is_admin = "admin" in user_roles
can_access_campaign_advisor = is_admin or "campaign_advisor" in user_roles

# Private deploy marker: visible only for Salvador to validate deployed version.
_PRIVATE_TEST_USERS = {"salvador.castrobay", "salvadorcastrobay", "salvadorcastrobay-hu"}
_show_private_test = current_user in _PRIVATE_TEST_USERS
if _show_private_test:
    st.markdown("---")
    st.subheader("TEST")
    st.markdown("---")

# ── Navigation (views/ dir avoids Streamlit auto-detection) ──

pages = {
    "Dashboards": [
        st.Page("views/executive_summary.py", title="Executive Summary", icon="📊", default=True),
        st.Page("views/product_intelligence.py", title="Product Intelligence", icon="🧩"),
        st.Page("views/competitive_intelligence.py", title="Competitive Intelligence", icon="⚔️"),
        st.Page("views/sales_enablement.py", title="Sales Enablement", icon="🎯"),
        st.Page("views/regional_gtm.py", title="Regional / GTM", icon="🌎"),
    ],
    "Detalle": [
        st.Page("views/pains_detail.py", title="Pains", icon="🔍"),
        st.Page("views/product_gaps_detail.py", title="Product Gaps", icon="🔍"),
        st.Page("views/faq_detail.py", title="FAQs", icon="🔍"),
    ],
    "Herramientas": [
        st.Page("views/sql_chat.py", title="Chat con IA", icon="🤖"),
        st.Page("views/comparative_analysis.py", title="Comparative Analysis", icon="⚖️"),
        st.Page("views/custom_dashboards.py", title="Dashboards Personalizados", icon="📈"),
        st.Page("views/glossary.py", title="Glosario y Cómo funciona", icon="📘"),
    ],
}

if can_access_campaign_advisor:
    pages["Marketing"] = [
        st.Page("views/marketing_actions.py", title="Campaign Advisor", icon="🚀"),
    ]

nav = st.navigation(pages)
_apply_sidebar_layout(nav.title)

# ── Load data & sidebar filters ──

pages_with_data = {
    "Executive Summary",
    "Comparative Analysis",
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
        prompt_version = get_dashboard_prompt_version()
        data_version = get_dashboard_data_version()
        df = load_data(prompt_version, data_version)
    st.session_state["df"] = df
    initialize_global_filters(df)
else:
    df = st.session_state.get("df", pd.DataFrame())
    if not df.empty:
        initialize_global_filters(df)

# ── Run selected page ──

nav.run()

# Private runtime debug rendered after pages/charts to capture same-run values.
if _show_private_test:
    tooltip_sig = str(inspect.signature(getattr(shared_module, "_render_viz_tooltip_if_any", lambda: None)))
    st.caption(f"shared.py: {getattr(shared_module, '__file__', 'N/A')}")
    st.caption(f"_humand_tooltip_wrapped: {getattr(st, '_humand_tooltip_wrapped', False)}")
    st.caption(f"renderer signature: {tooltip_sig}")
    st.caption(f"has dataframe_with_csv: {hasattr(shared_module, 'dataframe_with_csv')}")
    st.caption(f"csv debug status: {st.session_state.get('__csv_debug_last_status', 'N/A')}")
    st.caption(f"csv debug rows: {st.session_state.get('__csv_debug_last_rows', 'N/A')}")
    st.caption(f"csv debug has item: {st.session_state.get('__csv_debug_last_item_present', 'N/A')}")
    st.caption(f"csv debug chart key: {st.session_state.get('__csv_debug_last_chart_key', 'N/A')}")

# ── Footer ──

st.sidebar.markdown("---")
with st.sidebar:
    st.write(f"**{st.session_state.get('name')}**")
    authenticator.logout("Cerrar sesion")

if not st.session_state.get("authentication_status"):
    st.cache_data.clear()
    st.rerun()
