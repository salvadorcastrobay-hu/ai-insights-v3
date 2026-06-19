"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";
import type { PainsDetailData } from "@/lib/data/pains-detail-data";

type Props = { data: PainsDetailData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

export function PainsDetailView({ data, filteredRows }: Props) {
  const t = useTranslations("pains");
  const tl = useTaxonomyLabel();
  const {
    kpis,
    byModule,
    themeStatusHeat,
    phaseSummary,
    topPainsByPhase,
    painsByOutcome,
    themes,
    modules,
    painTableRows,
  } = data;
  const phaseTotal = phaseSummary.pre_sale + phaseSummary.closed + phaseSummary.post_sale;
  const pct = (n: number) => (phaseTotal > 0 ? `${Math.round((n / phaseTotal) * 100)}%` : "0%");
  const ratePct = (n: number) => `${Math.round(n * 100)}%`;

  const [theme, setTheme] = useState("");
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");

  const tableRows = useMemo(() => {
    return painTableRows.filter((row) => {
      if (theme && row.pain_theme !== theme) return false;
      if (module && row.module_display !== module) return false;
      if (search) {
        const blob = `${row.summary} ${row.verbatim_quote ?? ""} ${row.insight_subtype_display}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [painTableRows, theme, module, search]);

  const pctGeneral = kpis.total > 0 ? Math.round((kpis.generales / kpis.total) * 100) : 0;
  const pctLinked = kpis.total > 0 ? Math.round((kpis.vinculados / kpis.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("total")} value={kpis.total} caption={kpis.total > 0 ? t("totalCaption") : "—"} />
        <MetricCard label={t("generals")} value={kpis.generales} caption={t("generalsCaption", { pct: pctGeneral })} />
        <MetricCard label={t("linked")} value={kpis.vinculados} caption={t("linkedCaption", { pct: pctLinked })} />
      </section>

      <p className="text-[12px] text-[var(--color-text-secondary)]">
        {t("historicalNote")}
      </p>

      <section className="space-y-3">
        <ChartCard
          title={t("byModule")}
          rawRows={filteredRows}
          ask={{
            chartTitle: "Pains por módulo",
            chartKind: "horizontal-bar",
            description: "Top módulos por deals únicos con al menos un pain vinculado.",
            dimension: "module_display",
            scopeType: "pain",
            rows: byModule.map((r) => ({ label: r.name, value: r.value })),
          }}
        >
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            {t("byModuleCaption")}
          </p>
          <HorizontalBarChart data={byModule.map((d) => ({ ...d, name: tl(d.name) }))} height={360} />
        </ChartCard>
        <ChartCard title={t("themeByStatus")}>
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            {t("themeStatusCaption")}
          </p>
          <HeatMap rowLabels={themeStatusHeat.rowLabels} colLabels={themeStatusHeat.colLabels} values={themeStatusHeat.values} height={Math.max(480, themeStatusHeat.rowLabels.length * 46 + 140)} />
        </ChartCard>
      </section>

      {/* ─── Funnel phase cross-reference ─────────────────────────────── */}
      {phaseTotal > 0 ? (
        <section className="space-y-3">
          <PageTitle
            title={t("dealStatus")}
            subtitle={t("dealStatusSubtitle")}
          />

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label={t("presale")}
              value={phaseSummary.pre_sale}
              caption={t("presaleCaption", { pct: pct(phaseSummary.pre_sale) })}
            />
            <MetricCard
              label={t("closed")}
              value={phaseSummary.closed}
              caption={t("closedCaption", { pct: pct(phaseSummary.closed) })}
            />
            <MetricCard
              label={t("postsale")}
              value={phaseSummary.post_sale}
              caption={t("postsaleCaption", { pct: pct(phaseSummary.post_sale) })}
            />
          </div>

          {topPainsByPhase.length > 0 ? (
            <ChartCard title={t("byPhase")}>
              <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                {t("topPainsByPhaseCaption", { n: topPainsByPhase.length })}
              </p>
              <StackedBarChart
                data={topPainsByPhase.map((r) => ({
                  pain: tl(r.pain),
                  [t("presale")]: r.pre_sale,
                  [t("closed")]: r.closed,
                  [t("postsale")]: r.post_sale,
                }))}
                yKey="pain"
                stackKeys={[t("presale"), t("closed"), t("postsale")]}
                colorMap={{
                  [t("presale")]: "#5B7CFA",
                  [t("closed")]: "#94A3B8",
                  [t("postsale")]: "#F59E0B",
                }}
                exportFileName="pains-by-phase-stacked.csv"
              />
            </ChartCard>
          ) : null}

          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {t("phaseNote")}
          </p>
        </section>
      ) : null}

      {/* ─── Pains × Outcome (Won vs Lost) ─────────────────────────────── */}
      {painsByOutcome.length > 0 ? (
        <section className="space-y-3">
          <PageTitle
            title={t("byOutcome")}
            subtitle={t("byOutcomeSubtitle")}
          />

          <ChartCard title={t("winLostRate")}>
            <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
              {t("outcomeCaption")}
              <span className="ml-2 inline-block rounded bg-green-100 px-1.5 text-green-800">🟢 Win-rate &gt; 60%</span>
              <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 text-amber-800">⚠ Lost-rate &gt; 55%</span>
              <span className="ml-1 inline-block rounded bg-red-100 px-1.5 text-red-800">🔴 Lost-rate &gt; 70%</span>
            </p>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>{t("thPain")}</Th>
                    <Th>{t("thWon")}</Th>
                    <Th>{t("thLost")}</Th>
                    <Th>{t("thClosed")}</Th>
                    <Th>{t("thWinRate")}</Th>
                    <Th>{t("thLostRate")}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {painsByOutcome.map((row) => {
                    const isDealKiller = row.lost_rate > 0.7;
                    const isFriction = !isDealKiller && row.lost_rate > 0.55;
                    const isResonant = row.win_rate > 0.6;
                    return (
                      <Tr key={row.pain}>
                        <Td>
                          {isDealKiller ? "🔴 " : isFriction ? "⚠ " : isResonant ? "🟢 " : ""}
                          {row.pain}
                        </Td>
                        <Td>{row.won}</Td>
                        <Td>{row.lost}</Td>
                        <Td>{row.closed_total}</Td>
                        <Td>{ratePct(row.win_rate)}</Td>
                        <Td>{ratePct(row.lost_rate)}</Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          </ChartCard>

        </section>
      ) : null}

      <ChartCard title={t("detail")}>
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="">{t("allThemes")}</option>
            {themes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">{t("allModules")}</option>
            {modules.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <Input placeholder={t("searchPain")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="max-h-[420px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>{t("thPain")}</Th>
                <Th>{t("thTheme")}</Th>
                <Th>{t("thModule")}</Th>
                <Th>{t("thSegment")}</Th>
                <Th>{t("thCompany")}</Th>
                <Th>{t("thConf")}</Th>
                <Th>{t("thSummary")}</Th>
                <Th>{t("thQuote")}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {tableRows.map((row) => (
                <Tr key={row.id}>
                  <Td>{tl(row.insight_subtype_display)}</Td>
                  <Td>{row.pain_theme}</Td>
                  <Td>{tl(row.module_display ?? "")}</Td>
                  <Td>{row.segment}</Td>
                  <Td>{row.company_name}</Td>
                  <Td><ConfidenceBadge value={row.confidence} /></Td>
                  <Td>{row.summary}</Td>
                  <Td>{row.verbatim_quote}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}
