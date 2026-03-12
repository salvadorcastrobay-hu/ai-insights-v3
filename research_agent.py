from __future__ import annotations

import argparse
import json
import os
from typing import Any

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from duckduckgo_search import DDGS
from langchain import hub
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """Search the web and return JSON results with title, url and snippet."""
    results: list[dict[str, Any]] = []
    with DDGS() as ddgs:
        for item in ddgs.text(query, max_results=max_results):
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("href", ""),
                    "snippet": item.get("body", ""),
                }
            )
    return json.dumps(results, ensure_ascii=True)


@tool
def fetch_page(url: str, max_chars: int = 4000) -> str:
    """Fetch a web page and return cleaned text content."""
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    text = " ".join(soup.stripped_strings)
    return text[:max_chars]


def build_agent(model: str | None = None) -> AgentExecutor:
    model_name = model or os.getenv("RESEARCH_AGENT_MODEL", "gpt-4o-mini")
    llm = ChatOpenAI(model=model_name, temperature=0)
    prompt = hub.pull("hwchase17/openai-tools-agent")
    tools = [web_search, fetch_page]
    agent = create_tool_calling_agent(llm=llm, tools=tools, prompt=prompt)
    return AgentExecutor(agent=agent, tools=tools, verbose=True)


def run(question: str, model: str | None = None) -> str:
    agent = build_agent(model=model)
    result = agent.invoke(
        {
            "input": (
                "You are a research assistant. Always include a short answer and a "
                "Sources section with clickable URLs. Verify claims before answering. "
                f"Question: {question}"
            )
        }
    )
    return str(result["output"])


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Run the LangChain research agent")
    parser.add_argument("question", help="Question to research")
    parser.add_argument(
        "--model",
        default=None,
        help="Override model name (default: RESEARCH_AGENT_MODEL or gpt-4o-mini)",
    )
    args = parser.parse_args()
    answer = run(question=args.question, model=args.model)
    print(answer)


if __name__ == "__main__":
    main()
