import { Badge, Bar, Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { loadOwnBrandComparisons, loadSyntheses } from "@/lib/content/queries";
import { regionLabel, type OwnBrandComparison, type PatternLift } from "@/lib/content/types";

export const dynamic = "force-dynamic";

/**
 * El lift es un dato intrínsecamente comparativo, así que se muestra con una
 * barra y no solo con el número: escrito como texto, un 3,2× y un 1,1× ocupan
 * el mismo espacio y se ven igual.
 */
function LiftList({ title, rows }: { title: string; rows: PatternLift[] }) {
  const winners = rows.filter((r) => r.lift > 1).slice(0, 6);
  if (!winners.length) return null;
  const max = Math.max(...winners.map((r) => r.lift));

  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-2.5">
        {winners.map((row) => (
          <li key={row.key}>
            <div className="mb-1 flex items-baseline gap-2 text-[14px] leading-[1.4]">
              <span className="min-w-0 flex-1 truncate" title={row.key}>
                {row.key.replace(/_/g, " ")}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{row.lift}×</span>
              <span className="shrink-0 text-[12px] text-[var(--faint)]">
                {row.top_count} arriba
              </span>
            </div>
            <Bar value={row.lift} max={max} />
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
 *
 * Los tres hallazgos van separados y con su propio encabezado. Antes se
 * emitían como tres párrafos unidos con " · ", o sea la parte más accionable de
 * la app formateada como un CSV.
 */
function OwnBrand({ cmp }: { cmp: OwnBrandComparison }) {
  if (!cmp.own_posts) return null;
  const own = cmp.own_median_engagement;
  const ref = cmp.reference_median_engagement;

  const blocks = [
    {
      title: "Funcionan y casi no usamos",
      items: cmp.missing_patterns.map((p) => `${p.key.replace(/_/g, " ")} · ${p.lift}×`),
      tone: "brand" as const,
    },
    {
      title: "Temas que funcionan y no tocamos",
      items: cmp.missing_themes.map((t) => `${t.key.replace(/_/g, " ")} · ${t.lift}×`),
      tone: "brand" as const,
    },
    {
      title: "Usamos mucho, sin evidencia de que rinda",
      items: cmp.overused_patterns.map(
        (p) => `${p.key.replace(/_/g, " ")} · ${Math.round(p.own_share * 100)}% de lo nuestro`,
      ),
      tone: "muted" as const,
    },
  ].filter((b) => b.items.length);

  return (
    <div className="mt-5 rounded-[var(--r-m)] border border-[var(--border)] bg-[var(--surface-sunk)] p-4">
      <SectionLabel>Humand contra estos patrones</SectionLabel>

      {own !== null && ref !== null ? (
        <p className="mb-1 text-[14px] leading-[1.4]">
          Engagement mediano propio{" "}
          <span className="font-semibold tabular-nums">{own.toLocaleString("es")}</span> contra{" "}
          <span className="font-semibold tabular-nums">{ref.toLocaleString("es")}</span> de los
          referentes
        </p>
      ) : null}

      <p className="mb-3 text-[12px] leading-[1.4] text-[var(--faint)]">
        Se comparan nuestros {cmp.own_posts} posts contra los patrones de este mercado. Son los
        mismos posts en los tres: publicamos global, los patrones son locales.
      </p>

      {blocks.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {blocks.map((block) => (
            <div key={block.title}>
              <p className="mb-1.5 text-[12px] font-semibold leading-[1.4]">{block.title}</p>
              <div className="flex flex-wrap gap-1">
                {block.items.map((item) => (
                  <Badge key={item} tone={block.tone}>
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
          Sin diferencias claras contra los patrones de este mercado.
        </p>
      )}
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
        subtitle="El lift compara cuánto aparece un patrón arriba contra cuánto aparece en el total. Mayor a 1 significa que funciona mejor de lo que su frecuencia explicaría."
      />

      <div className="space-y-6">
        {syntheses.map((s) => (
          <Card key={s.region}>
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[18px] font-semibold leading-[1.4]">{regionLabel(s.region)}</h2>
              <span className="text-[12px] text-[var(--faint)]">
                {s.posts_considered} posts relevantes · corte superior {s.top_posts_count}
              </span>
            </div>

            {s.insufficient_sample ? (
              <div className="mb-4">
                <Callout>{s.insufficient_sample}</Callout>
              </div>
            ) : null}

            <div className="grid gap-6 sm:grid-cols-2">
              <LiftList title="Hooks que ganan" rows={s.winning_hooks ?? []} />
              <LiftList title="Temas que ganan" rows={s.winning_themes ?? []} />
            </div>

            {s.top_topics.length ? (
              <div className="mt-5">
                <SectionLabel>De qué hablan</SectionLabel>
                <div className="flex flex-wrap gap-1">
                  {s.top_topics.slice(0, 10).map((t) => (
                    <Badge key={t.key} tone="muted">
                      {t.key}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {ownByRegion.has(s.region) ? <OwnBrand cmp={ownByRegion.get(s.region)!} /> : null}
          </Card>
        ))}
      </div>

      <p className="mt-6 text-[12px] leading-[1.4] text-[var(--faint)]">
        Las ideas replicables que antes se listaban acá son el feed de{" "}
        <a href="/discovery" className="font-semibold text-[var(--brand-ink)] hover:underline">
          Qué funciona
        </a>{" "}
        — eran los mismos posts mostrados dos veces.
      </p>
    </>
  );
}
