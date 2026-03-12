"""
CLI for natural-language Supabase insights.

Example:
    python insights_copilot_cli.py "top 5 pain points in EMEA region"
"""

from __future__ import annotations

import argparse
import json

from insights_copilot import ask_insights


def main() -> None:
    parser = argparse.ArgumentParser(description="Ask sales insights in natural language.")
    parser.add_argument("question", help="Natural-language analytics question")
    parser.add_argument("--top-n", type=int, default=None, help="Override top_n limit")
    args = parser.parse_args()

    result = ask_insights(question=args.question, top_n=args.top_n)
    print("\nNARRATIVE\n---------")
    print(result["narrative"])
    print("\nSQL\n---")
    print(result["sql"])
    print("\nRESULT JSON\n-----------")
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
