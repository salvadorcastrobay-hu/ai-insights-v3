import { Clock3, Sparkles } from "lucide-react";

import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Metric = {
  label: string;
  value: string;
  delta?: string;
  trend?: "positive" | "negative" | "neutral";
  caption?: string;
};

type DashboardPlaceholderProps = {
  title: string;
  description: string;
  metrics: Metric[];
  bullets: string[];
  status?: string;
};

export function DashboardPlaceholder({
  title,
  description,
  metrics,
  bullets,
  status = "Ready for Track B/C integration",
}: DashboardPlaceholderProps) {
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[var(--radius-l)] border border-white/70 bg-[linear-gradient(135deg,#ffffff_0%,#f8faff_45%,#eef3ff_100%)] p-6 shadow-[var(--shadow-4dp)] md:p-8">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(73,107,227,0.18),transparent_58%)] lg:block" />
        <div className="relative space-y-4">
          <Badge>Frontend migration</Badge>
          <div className="space-y-2">
            <h1 className="m-0">{title}</h1>
            <p className="max-w-3xl text-[16px] leading-7 text-[var(--color-text-secondary)]">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--color-text-secondary)]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-neutral-200)] bg-white px-3 py-1.5">
              <Sparkles className="size-4 text-[var(--color-brand-500)]" />
              <span>{status}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-neutral-200)] bg-white px-3 py-1.5">
              <Clock3 className="size-4 text-[var(--color-text-secondary)]" />
              <span>Placeholder shell wired for data + charts</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border border-white/60">
          <CardHeader>
            <CardTitle>Page shell status</CardTitle>
            <CardDescription>
              This route is already protected by the new dashboard layout, sidebar, and Supabase session handling.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SectionHeader
              description="Track B and Track C can now plug real queries, global filters, and charts into this route without reworking the shell."
              title="What is already in place"
            />
            <ul className="space-y-3 pl-5 text-[14px] leading-6 text-[var(--color-text-secondary)]">
              {bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border border-dashed border-[var(--color-neutral-200)] bg-[var(--color-bg-card)]/80">
          <CardHeader>
            <CardTitle>Integration notes</CardTitle>
            <CardDescription>
              The layout already leaves room for the global filter bar and page-level content blocks from later tracks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-[14px] leading-6 text-[var(--color-text-secondary)]">
            <p>Use this page as the landing surface for the final charts and tables.</p>
            <p>Replace the placeholder metric cards with live computations once the data layer lands.</p>
            <p>Keep the page title and URL stable so middleware and sidebar links remain untouched.</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
