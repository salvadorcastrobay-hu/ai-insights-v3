"""Shared utilities for Humand Sales Insights dashboard."""

from __future__ import annotations

import os
from pathlib import Path
import re
import textwrap
import unicodedata
import json
import hashlib
import base64
from html import escape
from datetime import date

import streamlit as st
import yaml
from yaml.loader import SafeLoader
from supabase import create_client
import pandas as pd
from dotenv import load_dotenv

load_dotenv()


# Columns expected by dashboard pages. Keep schema stable even when query returns 0 rows.
DASHBOARD_COLUMNS = [
    "id",
    "insight_type",
    "insight_type_display",
    "insight_subtype",
    "insight_subtype_display",
    "region",
    "segment",
    "country",
    "industry",
    "deal_owner",
    "call_date",
    "module",
    "module_display",
    "hr_category_display",
    "transcript_id",
    "deal_id",
    "deal_name",
    "amount",
    "competitor_name",
    "competitor_relationship",
    "feature_display",
    "feature_name",
    "feature_is_seed",
    "pain_theme",
    "pain_scope",
    "module_status",
    "summary",
    "verbatim_quote",
    "company_name",
    "confidence",
    "gap_description",
    "gap_priority",
    "deal_stage",
    "competitor_relationship_display",
    "is_own_brand_competitor",
    "deal_source",
    "deal_source_detail",
    "acquisition_channel",
    "inbound_source",
    "partner_name",
]

# Columns fetched from v_insights_dashboard.
# Keep this list tight to reduce payload size and first-load latency.
LOAD_DATA_COLUMNS = [
    "id",
    "transcript_id",
    "deal_id",
    "deal_name",
    "company_name",
    "region",
    "country",
    "segment",
    "industry",
    "deal_stage",
    "deal_owner",
    "call_date",
    "amount",
    "insight_type",
    "insight_subtype",
    "module",
    "summary",
    "verbatim_quote",
    "confidence",
    "competitor_name",
    "competitor_relationship",
    "feature_name",
    "gap_description",
    "gap_priority",
    "insight_type_display",
    "insight_subtype_display",
    "module_display",
    "module_status",
    "hr_category_display",
    "pain_theme",
    "pain_scope",
    "feature_display",
    "feature_is_seed",
    "competitor_relationship_display",
]
LOAD_DATA_SELECT = ",".join(LOAD_DATA_COLUMNS)

COMPETITOR_NORMALIZATION = {
    "humand": "Humand",
    "human": "Humand",
    "human d": "Humand",
    "book": "Buk",
    "buk hr": "Buk",
    "bukhr": "Buk",
    "senior": "Senior",
    "solides": "Sólides",
    "solids": "Sólides",
    "fids": "Feedz",
    "feedz": "Feedz",
    "totus": "Totvs",
    "tots": "Totvs",
    "totvs": "Totvs",
}
OWN_BRAND_COMPETITOR_ALIASES = {"humand", "human", "human d"}
FILTER_PREFS_PATH = Path(__file__).parent / ".filter_prefs.json"
OFFICIAL_REGION_OPTIONS = [
    "HISPAM",
    "ANGLO AMERICA",
    "APAC",
    "Brazil",
    "EMEA",
    "MENA",
]
REGION_ALIASES = {
    "latam": "HISPAM",
    "hispam": "HISPAM",
    "santa fe province": "HISPAM",
    "mendoza province": "HISPAM",
    "mendoza": "HISPAM",
    "cordoba": "HISPAM",
    "cordoba province": "HISPAM",
    "cordoba capital": "HISPAM",
    "ciudad de mexico": "HISPAM",
    "ciudad de mexico cdmx": "HISPAM",
    "mexico city": "HISPAM",
    "community of madrid": "EMEA",
    "madrid": "EMEA",
    "espana": "EMEA",
    "spain": "EMEA",
    "emea": "EMEA",
    "anglo america": "ANGLO AMERICA",
    "north america": "ANGLO AMERICA",
    "namer": "ANGLO AMERICA",
    "na region": "ANGLO AMERICA",
    "apac": "APAC",
    "mena": "MENA",
    "brazil": "Brazil",
    "brasil": "Brazil",
}
HUBSPOT_DEAL_SOURCE_PROPERTY = "origen_del_contacto__from_where_we_got_the_call_"
HUBSPOT_DEAL_SOURCE_FALLBACKS = [
    "deal_source__bdr_",
    "sqo_source_channel",
    "hs_analytics_source",
    "hs_object_source_label",
]
HUBSPOT_DEAL_SOURCE_DETAIL_PROPERTY = "inbound_source"
HUBSPOT_DEAL_SOURCE_DETAIL_FALLBACKS = [
    "partner_name",
    "hs_analytics_source_data_1",
    "hs_analytics_latest_source_data_1",
]
ACQUISITION_CHANNEL_ALIASES = {
    "marketing": "Inbound",
    "inbound": "Inbound",
    "event": "Inbound",
    "prensa": "Inbound",
    "webinar": "Inbound",
    "google ads": "Inbound",
    "meta ads": "Inbound",
    "landing": "Inbound",
    "linkedin": "Inbound",
    "referrals": "Inbound",
    "organic search": "Inbound",
    "paid search": "Inbound",
    "email marketing": "Inbound",
    "organic social": "Inbound",
    "paid social": "Inbound",
    "direct traffic": "Inbound",
    "offline sources": "Inbound",
    "other campaigns": "Inbound",
    "ai referrals": "Inbound",
    "bdr": "Outbound",
    "ae": "Outbound",
    "cx": "Outbound",
    "external bdr": "Outbound",
    "outbound partner": "Outbound",
    "partner": "Partner / Referral",
    "referral partner": "Partner / Referral",
    "business partner": "Partner / Referral",
    "alliance": "Partner / Referral",
    "hu referral": "Partner / Referral",
    "standard cx referral": "Partner / Referral",
    "hu coins admin panel": "Partner / Referral",
    "offline": "Otros",
    "social_media": "Otros",
    "other campaigns": "Otros",
    "other": "Otros",
    "otros": "Otros",
    "alianza": "Otros",
}
GLOBAL_FILTER_DEFAULTS = {
    "types": "__all__",
    "regions": "__all__",
    "segments": [],
    "countries": [],
    "industries": [],
    "owners": [],
    "modules": [],
    "categories": [],
    "channels": [],
    "sources": [],
    "date_start": None,
    "date_end": None,
}


def _normalize_competitor_key(value: str) -> str:
    collapsed = " ".join(value.strip().split()).lower()
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", collapsed) if not unicodedata.combining(ch)
    )


def _normalize_text_key(value: str) -> str:
    return _normalize_competitor_key(value)


def normalize_competitor_name(value):
    if not isinstance(value, str):
        return value
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None
    normalized_key = _normalize_competitor_key(cleaned)
    return COMPETITOR_NORMALIZATION.get(normalized_key, cleaned)


def is_own_brand_competitor(value) -> bool:
    if not isinstance(value, str):
        return False
    normalized = _normalize_competitor_key(value)
    return normalized in OWN_BRAND_COMPETITOR_ALIASES


def normalize_region_name(value):
    if not isinstance(value, str):
        return value
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None
    normalized_key = _normalize_text_key(cleaned)
    return REGION_ALIASES.get(normalized_key, cleaned)


def _extract_first_property(props: dict, keys: list[str]) -> str | None:
    for key in keys:
        value = props.get(key)
        if isinstance(value, str):
            cleaned = " ".join(value.strip().split())
            if cleaned and cleaned.lower() != "n/a":
                return cleaned
        elif value not in (None, "", []):
            return str(value)
    return None


def derive_deal_source_fields(props: dict | None) -> dict[str, str | None]:
    props = props or {}
    deal_source = _extract_first_property(
        props,
        [HUBSPOT_DEAL_SOURCE_PROPERTY, *HUBSPOT_DEAL_SOURCE_FALLBACKS],
    )
    detail = _extract_first_property(
        props,
        [HUBSPOT_DEAL_SOURCE_DETAIL_PROPERTY, *HUBSPOT_DEAL_SOURCE_DETAIL_FALLBACKS],
    )
    partner_name = _extract_first_property(props, ["partner_name"])
    inbound_source = _extract_first_property(props, [HUBSPOT_DEAL_SOURCE_DETAIL_PROPERTY])
    acquisition_channel = normalize_acquisition_channel(deal_source or detail)
    if acquisition_channel is None and inbound_source:
        acquisition_channel = normalize_acquisition_channel(inbound_source)
    return {
        "deal_source": deal_source,
        "deal_source_detail": detail,
        "acquisition_channel": acquisition_channel,
        "inbound_source": inbound_source,
        "partner_name": partner_name,
    }


def normalize_acquisition_channel(value):
    if not isinstance(value, str):
        return value
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None
    normalized = _normalize_text_key(cleaned)
    return ACQUISITION_CHANNEL_ALIASES.get(normalized, "Otros")


def _filter_owner() -> str | None:
    owner = st.session_state.get("username") or st.session_state.get("name")
    if not owner:
        return None
    return str(owner).strip() or None

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
    # Prefer service role key in trusted local envs; fallback to standard key.
    api_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
    )
    if not api_key:
        try:
            api_key = (
                st.secrets.get("SUPABASE_SERVICE_ROLE_KEY")
                or st.secrets.get("SUPABASE_KEY")
            )
        except Exception:
            api_key = None
    if not api_key:
        raise RuntimeError(
            "Missing Supabase API key. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY."
        )
    return create_client(
        _get_secret("SUPABASE_URL"),
        api_key,
    )


def get_dashboard_prompt_version() -> str:
    """Return the prompt version the dashboard should display."""
    return os.environ.get("PROMPT_VERSION", "v3.0")


def get_dashboard_data_version() -> str:
    """Bump this when cached dashboard payload shape/derivations change."""
    return "2026-04-07-source-filters-v3"


def ensure_dashboard_schema(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure DataFrame has required columns to prevent KeyError on empty results."""
    if df is None or df.empty:
        base_cols = list(df.columns) if isinstance(df, pd.DataFrame) else []
        return pd.DataFrame(columns=list(dict.fromkeys(base_cols + DASHBOARD_COLUMNS)))

    for col in DASHBOARD_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA
    return df


@st.cache_data(show_spinner=False, ttl=300, max_entries=2, persist="disk")
def load_deal_properties(data_version: str) -> pd.DataFrame:
    client = get_supabase()
    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("raw_deals")
            .select("deal_id,properties")
            .order("deal_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += len(rows)

    if not all_rows:
        return pd.DataFrame(columns=["deal_id", "deal_source", "deal_source_detail", "acquisition_channel", "inbound_source", "partner_name"])

    enriched_rows = []
    for row in all_rows:
        props = row.get("properties") or {}
        if isinstance(props, str):
            try:
                props = json.loads(props)
            except json.JSONDecodeError:
                props = {}
        deal_id = row.get("deal_id")
        if deal_id is None:
            continue
        enriched_rows.append({"deal_id": str(deal_id), **derive_deal_source_fields(props)})
    if not enriched_rows:
        return pd.DataFrame(columns=["deal_id", "deal_source", "deal_source_detail", "acquisition_channel", "inbound_source", "partner_name"])
    deal_props = pd.DataFrame(enriched_rows)
    deal_props["deal_id"] = deal_props["deal_id"].astype(str)
    deal_props = deal_props.drop_duplicates(subset=["deal_id"], keep="last")
    return deal_props


@st.cache_data(show_spinner=False, ttl=300, max_entries=1, persist="disk")
def load_data(prompt_version: str, data_version: str) -> pd.DataFrame:
    """Load insights from the dashboard view, filtered by prompt_version."""
    client = get_supabase()
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("v_insights_dashboard")
            .select(LOAD_DATA_SELECT)
            .eq("prompt_version", prompt_version)
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break
        all_data.extend(rows)
        if len(rows) < page_size:
            break
        offset += len(rows)

    if not all_data:
        return ensure_dashboard_schema(pd.DataFrame())

    df = pd.DataFrame(all_data)
    df = ensure_dashboard_schema(df)
    if "deal_id" in df.columns:
        df["deal_id"] = df["deal_id"].astype(str)
        deal_props = load_deal_properties(data_version)
        if not deal_props.empty:
            deal_props["deal_id"] = deal_props["deal_id"].astype(str)
            df = df.merge(deal_props, how="left", on="deal_id", suffixes=("", "_deal"))
            for column in ["deal_source", "deal_source_detail", "acquisition_channel", "inbound_source", "partner_name"]:
                enriched_col = f"{column}_deal"
                if enriched_col in df.columns:
                    df[column] = df[column].combine_first(df[enriched_col])
                    df = df.drop(columns=[enriched_col])
    if "call_date" in df.columns:
        df["call_date"] = pd.to_datetime(df["call_date"], errors="coerce")
    if "amount" in df.columns:
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    if "region" in df.columns:
        df["region"] = df["region"].map(normalize_region_name)
    if "competitor_name" in df.columns:
        df["competitor_name"] = df["competitor_name"].map(normalize_competitor_name)
        df["is_own_brand_competitor"] = df["competitor_name"].map(is_own_brand_competitor)
    if "acquisition_channel" in df.columns:
        df["acquisition_channel"] = df["acquisition_channel"].map(normalize_acquisition_channel)
    df = ensure_dashboard_schema(df)
    return df


@st.cache_data(show_spinner=False, ttl=3600)
def load_total_transcripts_count() -> int:
    """Returns total count of processed transcripts in raw_transcripts."""
    client = get_supabase()
    result = client.table("raw_transcripts").select("*", count="exact").limit(0).execute()
    return result.count or 0


# ── Sidebar filters ──

@st.cache_data(show_spinner=False)
def _compute_filter_options(df: pd.DataFrame) -> dict:
    """Precompute sorted unique values for sidebar filters (cached)."""
    options: dict = {}
    options["types"] = sorted(df["insight_type_display"].dropna().unique())
    options["regions"] = [region for region in OFFICIAL_REGION_OPTIONS if region in set(df["region"].dropna().unique())]
    options["segments"] = sorted(df["segment"].dropna().unique()) if "segment" in df.columns else []
    options["countries"] = sorted(df["country"].dropna().unique()) if "country" in df.columns else []
    options["industries"] = sorted(df["industry"].dropna().unique()) if "industry" in df.columns else []
    options["owners"] = sorted(df["deal_owner"].dropna().unique()) if "deal_owner" in df.columns else []
    options["modules"] = sorted(df["module_display"].dropna().unique())
    options["categories"] = sorted(df["hr_category_display"].dropna().unique())
    options["channels"] = sorted(df["acquisition_channel"].dropna().unique()) if "acquisition_channel" in df.columns else []
    options["sources"] = sorted(df["deal_source"].dropna().unique()) if "deal_source" in df.columns else []
    if "call_date" in df.columns:
        valid_dates = df["call_date"].dropna()
        if not valid_dates.empty:
            options["min_date"] = valid_dates.min().date()
            options["max_date"] = valid_dates.max().date()
    return options


def _load_filter_preferences() -> dict:
    if not FILTER_PREFS_PATH.exists():
        return {}
    try:
        with open(FILTER_PREFS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_filter_preferences(owner: str | None, payload: dict) -> None:
    if not owner:
        return
    data = _load_filter_preferences()
    data[owner] = payload
    try:
        with open(FILTER_PREFS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=True, indent=2)
    except OSError:
        pass


def _coerce_saved_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _resolve_default_selection(options: list, saved_value, all_by_default: bool) -> list:
    if all_by_default and saved_value == "__all__":
        return list(options)
    if isinstance(saved_value, list):
        return [item for item in saved_value if item in options]
    return list(options) if all_by_default else []


def initialize_global_filters(df: pd.DataFrame) -> None:
    if df.empty:
        return

    opts = _compute_filter_options(df)
    owner = _filter_owner()
    saved = _load_filter_preferences().get(owner or "", {})

    for field, default in GLOBAL_FILTER_DEFAULTS.items():
        state_key = f"global_filter_{field}"
        if field in {"types", "regions"}:
            options = opts[field]
            if state_key not in st.session_state:
                st.session_state[state_key] = _resolve_default_selection(
                    options,
                    saved.get(field, default),
                    all_by_default=True,
                )
            else:
                st.session_state[state_key] = [item for item in st.session_state[state_key] if item in options]
            continue
        if field in {"segments", "countries", "industries", "owners", "modules", "categories", "channels", "sources"}:
            options = opts.get(field, [])
            if state_key not in st.session_state:
                st.session_state[state_key] = _resolve_default_selection(
                    options,
                    saved.get(field, default),
                    all_by_default=False,
                )
            else:
                st.session_state[state_key] = [item for item in st.session_state[state_key] if item in options]
            continue
        if field in {"date_start", "date_end"}:
            if state_key not in st.session_state:
                coerced = _coerce_saved_date(saved.get(field, default))
                if coerced is None:
                    coerced = opts.get("min_date") if field == "date_start" else opts.get("max_date")
                st.session_state[state_key] = coerced
            else:
                current = _coerce_saved_date(st.session_state.get(state_key))
                if current is None:
                    current = opts.get("min_date") if field == "date_start" else opts.get("max_date")
                min_allowed = opts.get("min_date")
                max_allowed = opts.get("max_date")
                if min_allowed and current < min_allowed:
                    current = min_allowed
                if max_allowed and current > max_allowed:
                    current = max_allowed
                st.session_state[state_key] = current


def _current_filter_payload() -> dict:
    payload = {}
    for field, default in GLOBAL_FILTER_DEFAULTS.items():
        value = st.session_state.get(f"global_filter_{field}", default)
        if field in {"date_start", "date_end"} and isinstance(value, date):
            payload[field] = value.isoformat()
        else:
            payload[field] = value
    return payload


def apply_global_filters(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    mask = pd.Series(True, index=df.index)

    selected_types = st.session_state.get("global_filter_types") or []
    if selected_types:
        mask &= df["insight_type_display"].isin(selected_types)

    selected_regions = st.session_state.get("global_filter_regions") or []
    if selected_regions and "region" in df.columns:
        mask &= df["region"].isin(selected_regions)

    selected_segments = st.session_state.get("global_filter_segments") or []
    if selected_segments and "segment" in df.columns:
        mask &= df["segment"].isin(selected_segments)

    selected_countries = st.session_state.get("global_filter_countries") or []
    if selected_countries and "country" in df.columns:
        mask &= df["country"].isin(selected_countries)

    selected_industries = st.session_state.get("global_filter_industries") or []
    if selected_industries and "industry" in df.columns:
        mask &= df["industry"].isin(selected_industries)

    selected_owners = st.session_state.get("global_filter_owners") or []
    if selected_owners and "deal_owner" in df.columns:
        mask &= df["deal_owner"].isin(selected_owners)

    selected_modules = st.session_state.get("global_filter_modules") or []
    if selected_modules and "module_display" in df.columns:
        mask &= df["module_display"].isin(selected_modules)

    selected_categories = st.session_state.get("global_filter_categories") or []
    if selected_categories and "hr_category_display" in df.columns:
        mask &= df["hr_category_display"].isin(selected_categories)

    selected_channels = st.session_state.get("global_filter_channels") or []
    if selected_channels and "acquisition_channel" in df.columns:
        mask &= df["acquisition_channel"].isin(selected_channels)

    selected_sources = st.session_state.get("global_filter_sources") or []
    if selected_sources and "deal_source" in df.columns:
        mask &= df["deal_source"].isin(selected_sources)

    start = st.session_state.get("global_filter_date_start")
    end = st.session_state.get("global_filter_date_end")
    if "call_date" in df.columns and (start or end):
        call_dates = df["call_date"].dt.date
        if start:
            mask &= call_dates >= start
        if end:
            mask &= call_dates <= end

    _save_filter_preferences(_filter_owner(), _current_filter_payload())
    return df[mask]


def get_filtered_data(df: pd.DataFrame | None = None) -> pd.DataFrame:
    source_df = df if isinstance(df, pd.DataFrame) else st.session_state.get("df")
    if source_df is None or getattr(source_df, "empty", True):
        return pd.DataFrame()
    return apply_global_filters(source_df)


def render_sidebar(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    opts = _compute_filter_options(df)
    initialize_global_filters(df)

    st.sidebar.multiselect("Tipo de Insight", opts["types"], key="global_filter_types")
    st.sidebar.multiselect("Region", opts["regions"], key="global_filter_regions")
    if opts["segments"]:
        st.sidebar.multiselect("Segmento", opts["segments"], key="global_filter_segments")
    if opts["countries"]:
        st.sidebar.multiselect("Pais", opts["countries"], key="global_filter_countries")
    if opts["industries"]:
        st.sidebar.multiselect("Industria", opts["industries"], key="global_filter_industries")
    if opts["owners"]:
        st.sidebar.multiselect("Deal Owner (AE)", opts["owners"], key="global_filter_owners")
    if opts["channels"]:
        st.sidebar.multiselect("Canal de adquisición", opts["channels"], key="global_filter_channels")
    if opts["sources"]:
        st.sidebar.multiselect("Fuente del deal", opts["sources"], key="global_filter_sources")
    st.sidebar.multiselect("Modulo", opts["modules"], key="global_filter_modules")
    st.sidebar.multiselect("Categoria HR", opts["categories"], key="global_filter_categories")
    if "min_date" in opts:
        st.sidebar.date_input("Desde", key="global_filter_date_start", min_value=opts["min_date"], max_value=opts["max_date"])
        st.sidebar.date_input("Hasta", key="global_filter_date_end", min_value=opts["min_date"], max_value=opts["max_date"])

    return apply_global_filters(df)


def render_inline_filters(df: pd.DataFrame, key_prefix: str = "page") -> pd.DataFrame:
    """Render filters as an inline expander at the top of a page. Returns filtered df."""
    if df.empty:
        return df

    opts = _compute_filter_options(df)
    initialize_global_filters(df)

    with st.expander("Filtros", expanded=False):
        fr1, fr2, fr3 = st.columns(3)
        fr1.multiselect("Tipo de Insight", opts["types"], key="global_filter_types")
        fr2.multiselect("Region", opts["regions"], key="global_filter_regions")
        fr3.multiselect("Segmento", opts["segments"], key="global_filter_segments")

        fr4, fr5, fr6 = st.columns(3)
        fr4.multiselect("País", opts["countries"], key="global_filter_countries")
        fr5.multiselect("Industria", opts["industries"], key="global_filter_industries")
        fr6.multiselect("Deal Owner (AE)", opts["owners"], key="global_filter_owners")

        fr7, fr8, fr9 = st.columns(3)
        fr7.multiselect("Módulo", opts["modules"], key="global_filter_modules")
        fr8.multiselect("Categoría HR", opts["categories"], key="global_filter_categories")
        if opts["channels"]:
            fr9.multiselect("Canal de adquisición", opts["channels"], key="global_filter_channels")

        fr10, fr11, fr12 = st.columns(3)
        if opts["sources"]:
            fr10.multiselect("Fuente del deal", opts["sources"], key="global_filter_sources")
        if "min_date" in opts:
            fr11.date_input("Desde", key="global_filter_date_start", min_value=opts["min_date"], max_value=opts["max_date"])
            fr12.date_input("Hasta", key="global_filter_date_end", min_value=opts["min_date"], max_value=opts["max_date"])

    return apply_global_filters(df)


# ── Formatting helpers ──

def format_currency(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}K"
    return f"${value:,.0f}"


def safe_nunique(series: pd.Series) -> int:
    return series.dropna().nunique()


# ── Label helpers ──

_STAGE_LABEL_ALIASES = {
    "decision maker engaged": "Decision Maker",
    "champion engaged": "Champion",
    "contract signed": "Contract Signed",
    "final negotiation": "Final Negotiation",
    "onboarding churned": "Onboarding Churned",
    "active partner": "Active Partner",
}
_STAGE_SANITIZE_PATTERN = re.compile(r"[^\w\s/&+\-]", flags=re.UNICODE)


def clean_stage_label(stage: str, max_chars: int = 16) -> str:
    """Clean and wrap stage labels to keep heatmap axes readable."""
    if stage is None:
        return ""
    text = " ".join(str(stage).strip().split())
    if not text:
        return ""

    normalized_key = _normalize_competitor_key(text)
    text = _STAGE_LABEL_ALIASES.get(normalized_key, text)
    text = _STAGE_SANITIZE_PATTERN.sub("", text)
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    return "<br>".join(textwrap.wrap(text, width=max_chars, break_long_words=False))


def topn_with_other(series: pd.Series, n: int, other_label: str = "Other") -> pd.Series:
    """Keep top N categories by frequency and bucket the rest into other_label."""
    if series is None or series.empty:
        return series
    counts = series.dropna().value_counts()
    if len(counts) <= n:
        return series
    top_values = set(counts.head(n).index.tolist())
    return series.where(series.isna() | series.isin(top_values), other_label)


# ── Display-name mapping ──

DISPLAY_NAMES = {
    "must_have": "Debe tener",
    "nice_to_have": "Deseable",
    "dealbreaker": "Dealbreaker",
    "general": "General",
    "module_linked": "Vinculado a Módulo",
    "existing": "Existente",
    "missing": "Faltante",
    "roadmap": "Roadmap",
    "technology": "Tecnología",
    "processes": "Procesos",
    "communication": "Comunicación",
    "talent": "Talento",
    "engagement": "Engagement",
    "data_and_analytics": "Datos y Analytics",
    "compliance_and_scale": "Compliance y Escala",
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


_TOOLTIP_QUEUE_KEY = "__viz_tooltip_queue"
if not hasattr(st, "_humand_original_plotly_chart"):
    st._humand_original_plotly_chart = st.plotly_chart
if not hasattr(st, "_humand_original_dataframe"):
    st._humand_original_dataframe = st.dataframe

_ORIGINAL_PLOTLY_CHART = st._humand_original_plotly_chart
_ORIGINAL_DATAFRAME = st._humand_original_dataframe


def _queue_viz_tooltip(text: str) -> None:
    queue = list(st.session_state.get(_TOOLTIP_QUEUE_KEY, []))
    queue.append(text)
    st.session_state[_TOOLTIP_QUEUE_KEY] = queue


def _pop_viz_tooltip() -> str | None:
    queue = list(st.session_state.get(_TOOLTIP_QUEUE_KEY, []))
    if not queue:
        return None
    text = queue.pop(0)
    st.session_state[_TOOLTIP_QUEUE_KEY] = queue
    return text


def _render_viz_tooltip_if_any(csv_item: dict | None = None) -> None:
    tooltip_text = _pop_viz_tooltip()
    if not tooltip_text and not csv_item:
        return

    left_col, right_col = st.columns([0.86, 0.14], gap="small")

    with left_col:
        if tooltip_text:
            st.markdown(
                f'<div style="display:flex;align-items:center;min-height:36px;">'
                f'<span style="color:#636271;font-family:Roboto,sans-serif;font-size:16px;line-height:1.15;cursor:help;">'
                f'ⓘ <span title="{escape(tooltip_text)}">Info de esta visualización</span></span>'
                "</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown('<div style="min-height:36px;"></div>', unsafe_allow_html=True)

    with right_col:
        if csv_item:
            encoded = base64.b64encode(csv_item["csv_data"].encode("utf-8")).decode("ascii")
            file_name = escape(str(csv_item["file_name"]))
            st.markdown(
                f'<div style="display:flex;align-items:center;justify-content:flex-end;min-height:36px;padding-right:8px;">'
                f'<a download="{file_name}" href="data:text/csv;charset=utf-8;base64,{encoded}" '
                'style="display:inline-block;padding:6px 10px;border:1px solid #dfe0e6;border-radius:4px;'
                'background:#f1f4fd;color:#496be3;text-decoration:none;font-family:Roboto,sans-serif;'
                'font-size:12px;font-weight:600;" title="Descargar los datos de este gráfico">CSV</a>'
                "</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown('<div style="min-height:36px;"></div>', unsafe_allow_html=True)

    # Space between the metadata row and the next chart/card block.
    st.markdown('<div style="height:12px;"></div>', unsafe_allow_html=True)


def _ensure_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if hasattr(value, "tolist"):
        converted = value.tolist()
        if isinstance(converted, list):
            return converted
    return [value]


def _as_scalar(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        return value.item()  # numpy scalar compatibility
    except Exception:
        pass
    if isinstance(value, (list, tuple, dict)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


def _customdata_to_columns(point_value) -> dict[str, object]:
    if isinstance(point_value, (list, tuple)):
        return {f"customdata_{idx + 1}": _as_scalar(val) for idx, val in enumerate(point_value)}
    if point_value is None:
        return {}
    return {"customdata_1": _as_scalar(point_value)}


def _figure_to_export_dataframe(fig) -> pd.DataFrame:
    chart_title = getattr(getattr(getattr(fig, "layout", None), "title", None), "text", None)
    x_axis_title = getattr(getattr(getattr(fig, "layout", None), "xaxis", None), "title", None)
    x_axis_title = getattr(x_axis_title, "text", None)
    y_axis_title = getattr(getattr(getattr(fig, "layout", None), "yaxis", None), "title", None)
    y_axis_title = getattr(y_axis_title, "text", None)

    rows: list[dict] = []
    traces = getattr(fig, "data", []) or []
    for idx, trace in enumerate(traces):
        trace_dict = trace.to_plotly_json() if hasattr(trace, "to_plotly_json") else {}
        trace_name = trace_dict.get("name") or f"serie_{idx + 1}"
        trace_type = trace_dict.get("type")
        trace_orientation = trace_dict.get("orientation")

        z_values = trace_dict.get("z")
        if isinstance(z_values, list) and z_values and isinstance(z_values[0], (list, tuple)):
            x_values = _ensure_list(trace_dict.get("x"))
            y_values = _ensure_list(trace_dict.get("y"))
            customdata_matrix = trace_dict.get("customdata")
            for row_idx, row in enumerate(z_values):
                row_label = y_values[row_idx] if row_idx < len(y_values) else row_idx
                for col_idx, cell_value in enumerate(row):
                    col_label = x_values[col_idx] if col_idx < len(x_values) else col_idx
                    custom_point = None
                    if (
                        isinstance(customdata_matrix, list)
                        and row_idx < len(customdata_matrix)
                        and isinstance(customdata_matrix[row_idx], (list, tuple))
                        and col_idx < len(customdata_matrix[row_idx])
                    ):
                        custom_point = customdata_matrix[row_idx][col_idx]
                    rows.append(
                        {
                            "chart_title": chart_title,
                            "x_axis_title": x_axis_title,
                            "y_axis_title": y_axis_title,
                            "trace_index": idx,
                            "serie": trace_name,
                            "trace_type": trace_type,
                            "orientation": trace_orientation,
                            "row_index": row_idx,
                            "column_index": col_idx,
                            "row": row_label,
                            "column": col_label,
                            "z": _as_scalar(cell_value),
                            **_customdata_to_columns(custom_point),
                        }
                    )
            continue

        point_arrays: dict[str, list] = {}
        candidate_keys = [
            "x", "y", "z", "labels", "values", "text", "hovertext", "ids",
            "theta", "r", "lon", "lat", "base", "width",
            "open", "high", "low", "close",
            "q1", "q3", "median", "mean", "sd", "lowerfence", "upperfence",
        ]
        for key in candidate_keys:
            values = _ensure_list(trace_dict.get(key))
            if values:
                point_arrays[key] = values

        marker = trace_dict.get("marker")
        if isinstance(marker, dict):
            for mk in ("size", "color", "symbol"):
                marker_vals = _ensure_list(marker.get(mk))
                if marker_vals:
                    point_arrays[f"marker_{mk}"] = marker_vals

        customdata = trace_dict.get("customdata")
        customdata_list = _ensure_list(customdata) if customdata is not None else []
        if customdata_list:
            point_arrays["customdata"] = customdata_list

        if not point_arrays:
            continue

        length = max(len(values) for values in point_arrays.values())
        for point_idx in range(length):
            row: dict[str, object] = {
                "chart_title": chart_title,
                "x_axis_title": x_axis_title,
                "y_axis_title": y_axis_title,
                "trace_index": idx,
                "serie": trace_name,
                "trace_type": trace_type,
                "orientation": trace_orientation,
                "point_index": point_idx,
            }
            for key, values in point_arrays.items():
                point_value = values[point_idx] if point_idx < len(values) else None
                if key == "customdata":
                    row.update(_customdata_to_columns(point_value))
                else:
                    row[key] = _as_scalar(point_value)
            rows.append(row)

    if not rows:
        return pd.DataFrame()

    export_df = pd.DataFrame(rows)
    all_null_cols = [col for col in export_df.columns if export_df[col].isna().all()]
    if all_null_cols:
        export_df = export_df.drop(columns=all_null_cols)
    return export_df


def _build_chart_csv_export_if_any(fig, chart_key: str | None = None) -> dict | None:
    export_df = _figure_to_export_dataframe(fig)
    try:
        st.session_state["__csv_debug_last_rows"] = int(len(export_df))
        st.session_state["__csv_debug_last_chart_key"] = chart_key
    except Exception:
        pass
    if export_df.empty:
        try:
            st.session_state["__csv_debug_last_status"] = "empty_export_df"
        except Exception:
            pass
        return None

    title = getattr(getattr(getattr(fig, "layout", None), "title", None), "text", None)
    filename_seed = chart_key or title or "chart-data"
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(filename_seed).strip().lower()).strip("-") or "chart-data"
    csv_data = export_df.to_csv(index=False)
    key_basis = f"{safe_name}:{len(export_df)}:{hashlib.md5(csv_data.encode('utf-8')).hexdigest()[:8]}"
    download_key = f"chart-csv-{key_basis}-{id(fig)}"
    return {
        "csv_data": csv_data,
        "file_name": f"{safe_name}.csv",
        "key": download_key,
    }


def _build_dataframe_csv_export_if_any(
    df: pd.DataFrame | None,
    file_name: str | None = None,
    filename_seed: str | None = None,
) -> dict | None:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return None

    export_df = df.copy()
    csv_data = export_df.to_csv(index=False)
    if not csv_data:
        return None

    if file_name:
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(file_name).strip().lower()).strip("-") or "detalle.csv"
        safe_name = safe_name if safe_name.endswith(".csv") else f"{safe_name}.csv"
    else:
        seed = filename_seed or "detalle"
        safe_seed = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(seed).strip().lower()).strip("-") or "detalle"
        safe_name = f"{safe_seed}.csv"

    key_basis = f"{safe_name}:{len(export_df)}:{hashlib.md5(csv_data.encode('utf-8')).hexdigest()[:8]}"
    download_key = f"table-csv-{key_basis}"
    return {
        "csv_data": csv_data,
        "file_name": safe_name,
        "key": download_key,
    }


def _plotly_chart_with_tooltip(*args, **kwargs):
    fig = args[0] if args else kwargs.get("figure")
    csv_item = None
    if fig is not None:
        chart_key = kwargs.get("key")
        csv_item = _build_chart_csv_export_if_any(fig, str(chart_key) if chart_key is not None else None)
    try:
        st.session_state["__csv_debug_last_item_present"] = bool(csv_item)
        st.session_state["__csv_debug_last_status"] = "ok" if csv_item else st.session_state.get("__csv_debug_last_status", "missing_item")
    except Exception:
        pass
    result = _ORIGINAL_PLOTLY_CHART(*args, **kwargs)
    _render_viz_tooltip_if_any(csv_item=csv_item)
    return result


def plotly_chart_with_csv(fig, **kwargs):
    chart_key = kwargs.get("key")
    csv_item = _build_chart_csv_export_if_any(fig, str(chart_key) if chart_key is not None else None)
    result = _ORIGINAL_PLOTLY_CHART(fig, **kwargs)
    _render_viz_tooltip_if_any(csv_item=csv_item)
    return result


def dataframe_with_csv(
    dataframe,
    export_df: pd.DataFrame | None = None,
    file_name: str | None = None,
    filename_seed: str | None = None,
    **kwargs,
):
    result = _ORIGINAL_DATAFRAME(dataframe, **kwargs)
    csv_source = export_df if export_df is not None else (dataframe if isinstance(dataframe, pd.DataFrame) else None)
    csv_item = _build_dataframe_csv_export_if_any(
        csv_source,
        file_name=file_name,
        filename_seed=filename_seed,
    )
    _render_viz_tooltip_if_any(csv_item=csv_item)
    return result


def _dataframe_with_tooltip(*args, **kwargs):
    result = _ORIGINAL_DATAFRAME(*args, **kwargs)
    _render_viz_tooltip_if_any()
    return result


# Always rebind wrappers so hot-reloads pick up the latest wrapper implementation.
# Safe because originals are stored in st._humand_original_* and never overwritten.
st.plotly_chart = _plotly_chart_with_tooltip
st.dataframe = _dataframe_with_tooltip
st._humand_tooltip_wrapped = True


def chart_tooltip(what_shows: str, how_to_read: str | None = None) -> None:
    """Queue one compact hover tooltip to be rendered below the next chart/table."""
    tooltip_text = what_shows.strip()
    if how_to_read:
        tooltip_text += f" {how_to_read.strip()}"
    _queue_viz_tooltip(tooltip_text)


def annotate_heatmap(fig, pivot, _max_value: float, _threshold: float, font_size: int = 13) -> None:
    """Annotate all cells (including zeros) of a px.imshow heatmap.

    Font color: white on dark cells (value >= 40% of max), dark on light cells.
    """
    pivot_max = float(pivot.to_numpy().max()) if pivot.size > 0 else 0.0
    if pivot_max <= 0:
        return
    for row_idx, row_name in enumerate(pivot.index):
        for col_idx, col_name in enumerate(pivot.columns):
            value = float(pivot.iat[row_idx, col_idx])
            color = "white" if pivot_max > 0 and (value / pivot_max) >= 0.4 else "#111111"
            fig.add_annotation(
                x=col_name, y=row_name, text=str(int(value)),
                showarrow=False,
                font=dict(size=font_size, color=color),
            )
