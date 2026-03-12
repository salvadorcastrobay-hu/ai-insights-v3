"""
MCP server for natural-language insights over Supabase.

Run locally:
    python insights_mcp_server.py
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from insights_copilot import (
    ask_insights,
    ask_insights_dashboard_package,
    list_supported_capabilities,
)

mcp = FastMCP("supabase-insights-copilot")


@mcp.tool()
def ask_sales_insights(question: str, top_n: int = 5) -> dict[str, Any]:
    """
    Ask for insights in natural language and get:
    - narrative answer
    - equivalent SQL (for traceability)
    - tabular rows
    - chart metadata
    """
    return ask_insights(question=question, top_n=top_n)


@mcp.tool()
def get_insights_dashboard_block(question: str, top_n: int = 10) -> dict[str, Any]:
    """
    Return data payload ready for dashboard rendering.
    """
    result = ask_insights(question=question, top_n=top_n)
    return {
        "narrative": result["narrative"],
        "sql": result["sql"],
        "columns": result["columns"],
        "rows": result["rows"],
        "chart": result["chart"],
        "plan": result["plan"],
        "generated_at": result["generated_at"],
    }


@mcp.tool()
def get_insights_dashboard_package(
    question: str,
    top_n: int = 10,
    trend_months: int = 6,
) -> dict[str, Any]:
    """
    Return an executive summary + multi-chart dashboard payload in one call.
    Useful for embedding directly into reporting UIs.
    """
    return ask_insights_dashboard_package(
        question=question,
        top_n=top_n,
        trend_months=trend_months,
    )


@mcp.tool()
def list_insights_capabilities() -> dict[str, Any]:
    """
    List supported intents, filters and example questions.
    """
    return list_supported_capabilities()


if __name__ == "__main__":
    mcp.run(transport="stdio")
