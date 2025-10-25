#!/usr/bin/env python3
"""Export catalog observability insights for merchandising experiments."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export catalog search insights (trending + zero-result queries)."
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the SMPLAT API service.",
    )
    parser.add_argument(
        "--api-key",
        required=True,
        help="Checkout API key (required for catalog observability endpoint).",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=5,
        help="Number of entries to include for trending/zero-result queries (default: 5).",
    )
    parser.add_argument(
        "--format",
        choices=("json", "md"),
        default="json",
        help="Export format (json or md).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to write the export. If omitted, prints to stdout.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="HTTP request timeout in seconds.",
    )
    return parser.parse_args()


def _format_markdown(payload: Dict[str, Any], top_n: int) -> str:
    trending_table = "\n".join(
        f"| {index + 1} | {item['query']} | {item['count']} |"
        for index, item in enumerate(payload["trending_queries"][:top_n])
    ) or "| — | — | — |"

    zero_results_table = "\n".join(
        f"| {index + 1} | {item['query']} | {item['count']} |"
        for index, item in enumerate(payload["zero_result_queries"][:top_n])
    ) or "| — | — | — |"

    return (
        "# Catalog Insights Export\n\n"
        f"- Total searches observed: **{payload['totals']['searches']}**\n"
        f"- Zero-result searches: **{payload['totals']['zero_results']}** "
        f"({payload['metrics'].get('zero_results_rate', 0.0):.1%})\n"
        f"- Average results per search: **{payload['metrics'].get('average_results_per_search', 0.0):.1f}**\n"
        f"- Snapshot generated from {payload['metadata']['sample_size']} recent searches\n"
        f"- Last search captured at: **{payload['metadata']['last_search_at'] or 'n/a'}**\n\n"
        "## Top Queries\n\n"
        "| Rank | Query | Count |\n"
        "| --- | --- | --- |\n"
        f"{trending_table}\n\n"
        "## Zero-Result Queries\n\n"
        "| Rank | Query | Count |\n"
        "| --- | --- | --- |\n"
        f"{zero_results_table}\n"
    )


def _format_payload(raw: Dict[str, Any], top_n: int) -> Dict[str, Any]:
    totals = raw.get("totals", {})
    metrics = raw.get("metrics", {})

    def _slice(entries: Dict[str, int]) -> List[Dict[str, Any]]:
        return [
            {"query": query, "count": count}
            for query, count in sorted(entries.items(), key=lambda item: item[1], reverse=True)[:top_n]
        ]

    return {
        "totals": {
            "searches": int(totals.get("searches", 0)),
            "zero_results": int(totals.get("zero_results", 0)),
        },
        "metrics": {
            "zero_results_rate": float(metrics.get("zero_results_rate", 0.0)),
            "average_results_per_search": float(metrics.get("average_results_per_search", 0.0)),
        },
        "trending_queries": _slice(raw.get("queries", {})),
        "zero_result_queries": _slice(raw.get("zero_result_queries", {})),
        "metadata": {
            "sample_size": len(raw.get("events", {}).get("recent", []) or []),
            "last_search_at": raw.get("events", {}).get("last_search_at"),
        },
    }


def main() -> None:
    args = parse_args()

    headers = {"X-API-Key": args.api_key}

    with httpx.Client(base_url=args.base_url, timeout=args.timeout) as client:
        response = client.get("/api/v1/observability/catalog-search", headers=headers)
        response.raise_for_status()
        raw_payload = response.json()

    payload = _format_payload(raw_payload, args.top_n)

    if args.format == "json":
        content = json.dumps(payload, indent=2)
    else:
        content = _format_markdown(payload, args.top_n)

    if args.output:
        args.output.write_text(content)
        print(f"[export-catalog-insights] ✅ wrote export to {args.output}")
    else:
        print(content)


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as exc:  # pragma: no cover
        print(
            f"[export-catalog-insights] ❌ HTTP {exc.response.status_code} while calling {exc.request.url}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as exc:  # pragma: no cover
        print(f"[export-catalog-insights] ❌ Unexpected error: {exc}", file=sys.stderr)
        sys.exit(1)
