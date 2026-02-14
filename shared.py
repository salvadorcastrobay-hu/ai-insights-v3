"""Shared utilities for Humand Sales Insights dashboard."""

from __future__ import annotations

import os
from pathlib import Path

import streamlit as st
import yaml
from yaml.loader import SafeLoader
from supabase import create_client
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

# ── Auth helpers ──

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_auth_config():
    with open(CONFIG_PATH) as f:
        return yaml.load(f, Loader=SafeLoader)


def save_auth_config(config):
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, default_flow_style=False)


# ── Secrets & data ──

def _get_secret(key: str) -> str:
    """Read from env vars (local) or st.secrets (Streamlit Cloud)."""
    val = os.environ.get(key)
    if val:
        return val
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        raise RuntimeError(f"Missing secret: {key}. Set it as env var or in Streamlit Cloud secrets.")


@st.cache_resource
def get_supabase():
    return create_client(
        _get_secret("SUPABASE_URL"),
        _get_secret("SUPABASE_KEY"),
    )


@st.cache_data(ttl=300)
def load_data() -> pd.DataFrame:
    """Load insights from the dashboard view."""
    client = get_supabase()
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("v_insights_dashboard")
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_data.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size

    if not all_data:
        return pd.DataFrame()

    df = pd.DataFrame(all_data)
    if "call_date" in df.columns:
        df["call_date"] = pd.to_datetime(df["call_date"], errors="coerce")
    if "amount" in df.columns:
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    return df


# ── Sidebar filters ──

def render_sidebar(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    # Insight type filter
    types = sorted(df["insight_type_display"].dropna().unique())
    selected_types = st.sidebar.multiselect("Tipo de Insight", types, default=types)

    # Region filter
    regions = sorted(df["region"].dropna().unique())
    selected_regions = st.sidebar.multiselect("Region", regions, default=regions)

    # Segment filter
    if "segment" in df.columns:
        segments = sorted(df["segment"].dropna().unique())
        selected_segments = st.sidebar.multiselect("Segmento", segments)
    else:
        selected_segments = []

    # Country filter
    if "country" in df.columns:
        countries = sorted(df["country"].dropna().unique())
        selected_countries = st.sidebar.multiselect("Pais", countries)
    else:
        selected_countries = []

    # Deal Owner (AE) filter
    if "deal_owner" in df.columns:
        owners = sorted(df["deal_owner"].dropna().unique())
        selected_owners = st.sidebar.multiselect("Deal Owner (AE)", owners)
    else:
        selected_owners = []

    # Date range filter
    if "call_date" in df.columns:
        valid_dates = df["call_date"].dropna()
        if not valid_dates.empty:
            min_date = valid_dates.min().date()
            max_date = valid_dates.max().date()
            date_range = st.sidebar.date_input(
                "Rango de fechas",
                value=(min_date, max_date),
                min_value=min_date,
                max_value=max_date,
            )
        else:
            date_range = None
    else:
        date_range = None

    # Module filter
    modules = sorted(df["module_display"].dropna().unique())
    selected_modules = st.sidebar.multiselect("Modulo", modules)

    # HR Category filter
    categories = sorted(df["hr_category_display"].dropna().unique())
    selected_categories = st.sidebar.multiselect("Categoria HR", categories)

    # Apply filters
    mask = df["insight_type_display"].isin(selected_types) & df["region"].isin(selected_regions)
    if selected_segments:
        mask &= df["segment"].isin(selected_segments)
    if selected_countries:
        mask &= df["country"].isin(selected_countries)
    if selected_owners:
        mask &= df["deal_owner"].isin(selected_owners)
    if date_range and isinstance(date_range, tuple) and len(date_range) == 2:
        start, end = date_range
        mask &= (df["call_date"].dt.date >= start) & (df["call_date"].dt.date <= end)
    if selected_modules:
        mask &= df["module_display"].isin(selected_modules)
    if selected_categories:
        mask &= df["hr_category_display"].isin(selected_categories)

    return df[mask]


# ── Formatting helpers ──

def format_currency(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}K"
    return f"${value:,.0f}"


def safe_nunique(series: pd.Series) -> int:
    return series.dropna().nunique()


# ── Display-name mapping ──

DISPLAY_NAMES = {
    "must_have": "Debe tener",
    "nice_to_have": "Deseable",
    "dealbreaker": "Dealbreaker",
    "general": "General",
    "module_linked": "Vinculado a Módulo",
    "existing": "Existente",
    "missing": "Faltante",
    "technology": "Tecnología",
    "processes": "Procesos",
    "communication": "Comunicación",
    "talent": "Talento",
    "engagement": "Engagement",
    "data": "Datos",
    "compliance": "Compliance",
    "compensation": "Compensación",
    "operations": "Operaciones",
}


def humanize(value):
    """Return a human-readable Spanish label for a raw enum/code value."""
    if not isinstance(value, str):
        return value
    return DISPLAY_NAMES.get(value, value.replace("_", " ").title())
