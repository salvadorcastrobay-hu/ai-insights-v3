import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
} from "@/lib/data/dashboard-aggregations";
import type { InsightRow } from "@/lib/supabase/types";

export type NameValue = { name: string; value: number };

export type FaqTableRow = {
  id: string;
  insight_subtype_display: string;
  summary: string;
  verbatim_quote: string | null;
  confidence: number | null;
  faq_answer: string | null;
};

export type FaqDetailData = {
  kpis: {
    totalFaqs: number;
    uniqueTopics: number;
    questionsPerDemo: string;
  };
  topicCounts: NameValue[];
  topics: string[];
  // precomputed top 5 questions per topic
  topQuestionsByTopic: Record<string, NameValue[]>;
  faqTableRows: FaqTableRow[];
};

export function buildFaqDetailData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): FaqDetailData {
  const filteredRows = applyFilters(rows, filters);
  const faqs = filterByType(filteredRows, "faq");

  const topics = [...new Set(faqs.map((row) => row.insight_subtype_display).filter(Boolean))] as string[];

  const totalFaqs = faqs.length;
  const uniqueTopics = distinctCount(faqs, "insight_subtype_display");
  const distinctTranscripts = distinctCount(faqs, "transcript_id");
  const questionsPerDemo =
    distinctTranscripts > 0 ? (totalFaqs / distinctTranscripts).toFixed(2) : "0.00";

  const topQuestionsByTopic: Record<string, NameValue[]> = {};
  for (const topic of topics) {
    topQuestionsByTopic[topic] = groupDistinctTranscripts(
      faqs.filter((row) => row.insight_subtype_display === topic),
      "summary",
      5,
    );
  }

  const faqTableRows: FaqTableRow[] = faqs.map((row) => ({
    id: row.id,
    insight_subtype_display: row.insight_subtype_display,
    summary: row.summary,
    verbatim_quote: row.verbatim_quote,
    confidence: row.confidence ?? null,
    faq_answer: row.faq_answer ?? null,
  }));

  return {
    kpis: { totalFaqs, uniqueTopics, questionsPerDemo },
    topicCounts: groupDistinctTranscripts(faqs, "insight_subtype_display", 15),
    topics,
    topQuestionsByTopic,
    faqTableRows,
  };
}
