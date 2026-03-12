"""Cached computation helpers for dashboard views.

These functions wrap common pandas operations with @st.cache_data so repeated
calls with the same filtered DataFrame return instantly from cache.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st


@st.cache_data(show_spinner=False)
def cached_value_counts(
    df: pd.DataFrame,
    column: str,
    n: int = 10,
) -> pd.DataFrame:
    """Return top-n value_counts as a two-column DataFrame."""
    counts = df[column].value_counts().head(n).reset_index()
    counts.columns = [column, "count"]
    return counts


@st.cache_data(show_spinner=False)
def cached_dedup_groupby(
    df: pd.DataFrame,
    dedup_cols: tuple[str, ...],
    group_col: str,
    agg_col: str | None = None,
    agg_func: str = "size",
    n: int | None = None,
) -> pd.DataFrame:
    """Drop duplicates, groupby, aggregate, sort desc, optionally head(n).

    - agg_func='size': count rows per group → column 'count'
    - agg_func='sum': sum agg_col per group → column 'total'
    """
    work = df.drop_duplicates(subset=list(dedup_cols))
    if agg_func == "size":
        result = (
            work.groupby(group_col)
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
        )
    elif agg_func == "sum" and agg_col:
        result = (
            work.groupby(group_col)[agg_col]
            .sum()
            .reset_index(name="total")
            .sort_values("total", ascending=False)
        )
    else:
        return pd.DataFrame()
    if n is not None:
        result = result.head(n)
    return result


@st.cache_data(show_spinner=False)
def cached_unique_deals_revenue(df: pd.DataFrame) -> float:
    """Sum of amount across unique deal_ids."""
    return float(df.drop_duplicates("deal_id")["amount"].sum())


@st.cache_data(show_spinner=False)
def cached_pains_with_pct(pains: pd.DataFrame, n: int = 10) -> pd.DataFrame:
    """Returns top-n pains by unique demo count, with % of total demos."""
    total_demos = pains["transcript_id"].nunique()
    result = (
        pains.groupby("insight_subtype_display")["transcript_id"]
        .nunique()
        .sort_values(ascending=False)
        .head(n)
        .reset_index()
    )
    result.columns = ["Pain", "Demos"]
    if total_demos > 0:
        result["% del total"] = (result["Demos"] / total_demos * 100).round(1).astype(str) + "%"
    else:
        result["% del total"] = "0.0%"
    return result
