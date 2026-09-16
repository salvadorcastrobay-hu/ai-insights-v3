import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { loadOwnBrandComparisons, loadSyntheses } from "@/lib/content/queries";
import {
  regionLabel,
  type OwnBrandComparison,
  type PatternLift,
} from "@/lib/content/types";

export const dynamic = "force-dynamic";

function LiftTable({ title, rows }: { title: string; rows: PatternLift[] }) {
  const winners = rows.filter((r) => r.lift > 1);
  if (!winners.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">{title}</p>
      <ul className="space-y-1">
        {winners.slice(0, 6).map((row) => (
          <li key={row.key} className="flex items-baseline gap-2 text-sm">
            <span className="w-40 truncate">{row.key}</span>
            <span className="font-medium">{row.lift}×</span>
            <span className="text-xs text-[var(--muted)]">({row.top_count} en el top)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Lo que pide el prompt maestro del brief: comparar el desempeño propio contra
 * los patrones detectados. Sin esto sabemos qué funciona pero no si lo estamos
 * aplicando.
 */
function OwnBrand({ cmp }: { cmp: OwnBrandComparison }) {
  if (!cmp.own_posts) return null;
  const own = cmp.own_median_engagement;
  const ref = cmp.reference_median_engagement;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
        Humand contra estos patrones
      </p>

      {own !== null && ref !== null ? (
        <p className="mb-2 text-sm">
          Engagement mediano propio <span className="font-medium">{own.toLocaleString("es")}</span>{" "}
          vs. <span className="font-medium">{ref.toLocaleString("es")}</span> de los referentes
        </p>
      ) : null}

      <p className="mb-2 text-xs text-[var(--muted)]">
        Se comparan nuestros {cmp.own_posts} posts contra los patrones de este mercado.
        Son los mismos posts en los tres: publicamos global, los patrones son locales.
      </p>

      {cmp.missing_patterns.length ? (
        <p className="text-sm">
          <span className="font-medium">Hooks que funcionan y casi no usamos:</span>{" "}
          {cmp.missing_patterns.map((p) => `${p.key} (${p.lift}×)`).join(" · ")}
        </p>
      ) : null}

      {cmp.missing_themes.length ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">Temas que funcionan y no tocamos:</span>{" "}
          {cmp.missing_themes.map((t) => `${t.key} (${t.lift}×)`).join(" · ")}
        </p>
      ) : null}

      {cmp.overused_patterns.length ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">Usamos mucho, sin evidencia de que rinda:</span>{" "}
          {cmp.overused_patterns
            .map((p) => `${p.key} (${Math.round(p.own_share * 100)}% de lo nuestro)`)
            .join(" · ")}
        </p>
      ) : null}

      {!cmp.missing_patterns.length &&
      !cmp.missing_themes.length &&
      !cmp.overused_patterns.length ? (
        <p className="text-sm text-[var(--muted)]">
          Sin diferencias claras contra los patrones de este mercado.
        </p>
      ) : null}
    </div>
  );
}

export default async function InsightsPage() {
  const [syntheses, ownComparisons] = await Promise.all([
    loadSyntheses(),
    loadOwnBrandComparisons().catch(() => []),
  ]);
  const ownByRegion = new Map(ownComparisons.map((c) => [c.region, c.comparison]));

  if (!syntheses.length) {
    return (
      <>
        <PageHeader title="Patrones" />
        <EmptyState title="Todavía no hay síntesis generada" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Patrones"
        subtitle="El lift compara cuánto aparece un patrón arriba contra cuánto aparece en el total. Mayor a 1 = funciona mejor de lo que su frecuencia explicaría."
      />

      <div className="space-y-6">
        {syntheses.map((s) => (
          <Card key={s.region}>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-base font-semibold">{regionLabel(s.region)}</h2>
              <span className="text-xs text-[var(--muted)]">
                {s.posts_considered} posts relevantes · corte superior {s.top_posts_count}
              </span>
            </div>

            {s.insufficient_sample ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {s.insufficient_sample}
              </p>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <LiftTable title="Hooks que ganan" rows={s.winning_hooks ?? []} />
              <LiftTable title="Temas que ganan" rows={s.winning_themes ?? []} />
            </div>

            {s.top_topics.length ? (
              <div className="mt-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                  De qué hablan
                </p>
                <div className="flex flex-wrap gap-1">
                  {s.top_topics.slice(0, 10).map((t) => (
                    <Badge key={t.key} tone="muted">
                      {t.key}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {s.replicable_ideas.length ? (
              <div className="mt-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
                  Ideas replicables
                </p>
                <ul className="space-y-2">
                  {s.replicable_ideas.slice(0, 5).map((idea) => (
                    <li key={idea.post_url ?? idea.hook} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{idea.hook_pattern}</Badge>
                        {idea.outlier_factor ? (
                          <span className="text-xs text-[var(--muted)]">
                            {idea.outlier_factor.toFixed(0)}× su promedio
                          </span>
                        ) : null}
                        {idea.post_url ? (
                          <a
                            href={idea.post_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--brand)] underline"
                          >
                            ver
                          </a>
                        ) : null}
                      </div>
                      <p className="mt-0.5">{idea.hook}</p>
                      <p className="text-[var(--muted)]">→ {idea.humand_angle}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {ownByRegion.has(s.region) ? <OwnBrand cmp={ownByRegion.get(s.region)!} /> : null}
          </Card>
        ))}
      </div>
    </>
  );
}
