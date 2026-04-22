import type {
  CampaignAngle,
  ChatMessageModel,
  DataTablePayload,
  MarketingRecommendation,
  SearchResult,
} from "./types";

function tableToMarkdown(table: DataTablePayload, title?: string): string {
  if (!table.columns?.length) return "";
  const header = `| ${table.columns.join(" | ")} |`;
  const sep = `| ${table.columns.map(() => "---").join(" | ")} |`;
  const body = table.rows
    .map(
      (row) =>
        `| ${table.columns
          .map((c) => String(row[c] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "))
          .join(" | ")} |`,
    )
    .join("\n");
  return `${title ? `### ${title}\n\n` : ""}${header}\n${sep}\n${body}`;
}

function sqlBlock(label: string, sql: string | null | undefined): string {
  if (!sql) return "";
  return `#### ${label}\n\n\`\`\`sql\n${sql.trim()}\n\`\`\``;
}

function searchResultsToMarkdown(results: SearchResult[]): string {
  if (!results.length) return "";
  const lines = [`### Search results (${results.length})`, ""];
  results.forEach((r, i) => {
    const meta = [
      r.company_name || "—",
      r.segment || "—",
      r.call_date || "—",
      r.source_type || "transcript",
      r.similarity != null ? `sim ${r.similarity.toFixed(3)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`**${i + 1}. ${meta}**`);
    if (r.chunk_text) lines.push("", r.chunk_text.trim(), "");
  });
  return lines.join("\n");
}

function angleToMarkdown(angle: CampaignAngle): string {
  const lines = [
    `### Angle ${angle.rank} — ${angle.title}`,
    `**Action type:** ${angle.action_type}`,
    `**Target audience:** ${angle.target_audience}`,
    ``,
    `**Hero message:** ${angle.hero_message}`,
    ``,
    `**Core message:** ${angle.core_message}`,
    ``,
    `**Key pain addressed:** ${angle.key_pain_addressed}`,
    ``,
    `**Supporting data:** ${angle.supporting_data}`,
  ];
  if (angle.channels?.length) {
    lines.push("", `**Channels:** ${angle.channels.join(", ")}`);
  }
  if (angle.content_ideas?.length) {
    lines.push("", `**Content ideas:**`, ...angle.content_ideas.map((c) => `- ${c}`));
  }
  if (angle.qualification_checks?.length) {
    lines.push(
      "",
      `**Qualification checks:**`,
      ...angle.qualification_checks.map((c) => `- ${c}`),
    );
  }
  if (angle.priority) lines.push("", `**Priority:** ${angle.priority}`);
  if (angle.launch_readiness) lines.push(`**Launch readiness:** ${angle.launch_readiness}`);
  if (angle.rationale) lines.push("", `**Rationale:** ${angle.rationale}`);
  return lines.join("\n");
}

function recommendationToMarkdown(rec: MarketingRecommendation): string {
  const parts: string[] = [];
  parts.push(`## Recomendación`);
  parts.push("");
  parts.push(`**Segment summary:** ${rec.segment_summary}`);
  parts.push("");
  parts.push(
    `**Idioma:** ${rec.recommended_market_language} · **Tono:** ${rec.market_tone} · **Confianza:** ${rec.data_confidence} · **Freshness:** ${rec.freshness_window}`,
  );
  if (rec.confidence_reason) {
    parts.push("", `_${rec.confidence_reason}_`);
  }
  if (rec.qualification_summary?.length) {
    parts.push(
      "",
      `### Qualification summary`,
      ...rec.qualification_summary.map((q) => `- ${q}`),
    );
  }
  if (rec.recommended_angles?.length) {
    parts.push("");
    for (const angle of rec.recommended_angles) {
      parts.push(angleToMarkdown(angle), "");
    }
  }
  if (rec.what_not_to_do?.length) {
    parts.push(`### Qué NO hacer`, ...rec.what_not_to_do.map((q) => `- ${q}`));
  }
  return parts.join("\n");
}

export function messageToMarkdown(message: ChatMessageModel): string {
  const out: string[] = [];
  if (message.content?.trim()) {
    out.push(message.content.trim());
  }
  if (message.recommendation) {
    out.push("", recommendationToMarkdown(message.recommendation));
  }
  if (message.warnings?.length) {
    out.push("", `### Warnings`, ...message.warnings.map((w) => `- ${w}`));
  }
  if (message.table) out.push("", tableToMarkdown(message.table, "Results"));
  if (message.quant_table)
    out.push("", tableToMarkdown(message.quant_table, "Quantitative results"));
  if (message.qual_table)
    out.push("", tableToMarkdown(message.qual_table, "Qualitative results"));
  if (message.search_sql_table)
    out.push("", tableToMarkdown(message.search_sql_table, "Complementary SQL results"));
  if (message.search_results?.length)
    out.push("", searchResultsToMarkdown(message.search_results));
  if (message.sql || message.quant_sql || message.qual_sql || message.search_sql) {
    out.push("", "## SQL");
    out.push("", sqlBlock("Generated SQL", message.sql));
    out.push(sqlBlock("Quantitative SQL", message.quant_sql));
    out.push(sqlBlock("Qualitative SQL", message.qual_sql));
    out.push(sqlBlock("Search SQL", message.search_sql));
  }
  return out.filter(Boolean).join("\n").trim();
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
