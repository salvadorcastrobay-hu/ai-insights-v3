import { Badge, Bar, Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { loadOwnBrandComparisons, loadSyntheses } from "@/lib/content/queries";
import {
  regionLabel,
  type MarketPosition,
  type OwnBrandComparison,
  type PatternLift,
} from "@/lib/content/types";

export const dynamic = "force-dynamic";

/**
 * El lift es un dato intrínsecamente comparativo, así que se muestra con una
 * barra y no solo con el número: escrito como texto, un 3,2× y un 1,1× ocupan
 * el mismo espacio y se ven igual.
 */

const STANCE_LABELS: Record<string, string> = {
  a_favor: "A favor",
  en_contra: "En contra",
  condicional: "Con condiciones",
  descriptivo: "Sin tomar partido",
};

/**
 * Una tensión del mercado: sobre qué se discute, quién sostiene cada lado, y
 * cuál de los dos rinde.
 *
 * Es lo único de toda la app que dice QUÉ decir. El lift de hooks dice un
 * formato —"empezá en primera persona"— y las piezas que salen de ahí pueden
 * decir cualquier cosa. Esto dice de qué lado pararse, con la evidencia al
 * lado para poder discutirlo.
 */
function Tension({ position }: { position: MarketPosition }) {
  const [mejor, ...resto] = position.sides;
  return (
    <div className="rounded-[var(--r-m)] border border-[var(--border)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[14px] font-semibold leading-[1.4]">{position.object_label}</h3>
        <span className="text-[12px] text-[var(--faint)]">
          {position.posts} posts · {position.authors} autores
        </span>
        {position.is_tension ? (
          <Badge tone="brand">está en disputa</Badge>
        ) : (
          <Badge tone="muted">hay consenso</Badge>
        )}
        {position.is_tension && position.asymmetry && position.asymmetry >= 1.5 ? (
          <span className="ml-auto text-[12px] font-semibold text-[var(--brand-ink)]">
            un lado rinde {position.asymmetry}×
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        {[mejor, ...resto].filter(Boolean).map((side, index) => (
          <div
            key={side.stance}
            className={index === 0 && position.is_tension ? "rounded-[var(--r-s)] bg-[var(--brand-soft)] p-2" : "p-2"}
          >
            <p className="mb-1 text-[12px] leading-[1.4]">
              <span className="font-semibold">{STANCE_LABELS[side.stance] ?? side.stance}</span>
              <span className="text-[var(--faint)]">
                {" "}
                · {side.posts} posts, {side.authors} autores
                {side.median_outlier ? ` · mediana ${side.median_outlier.toFixed(1)}×` : ""}
              </span>
              {index === 0 && position.is_tension ? (
                <span className="ml-2 font-semibold text-[var(--brand-ink)]">← este lado rinde</span>
              ) : null}
            </p>
            <ul className="space-y-0.5">
              {side.claims.slice(0, 3).map((c) => (
                <li key={c.post_url ?? c.claim} className="text-[14px] leading-[1.4]">
                  <span className="text-[var(--muted)]">“{c.claim}”</span>{" "}
                  {c.post_url ? (
                    <a
                      href={c.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap text-[12px] text-[var(--brand-ink)] hover:underline"
                    >
                      @{c.author_handle}
                      {c.outlier_factor ? ` ${c.outlier_factor.toFixed(1)}×` : ""} ↗
                    </a>
                  ) : (
                    <span className="text-[12px] text-[var(--faint)]">@{c.author_handle}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

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

            {/* Primero de qué se discute, después con qué formato: el formato
                sin el mensaje no le dice a nadie qué escribir. */}
            {s.positions?.length ? (
              <div className="mb-5">
                <SectionLabel>
                  {s.positions.some((p) => p.is_tension)
                    ? "Sobre qué discute el mercado"
                    : "De qué se habla, y desde qué postura"}
                </SectionLabel>
                {/*
                  Cuando no hay ninguna tensión hay que decirlo. Una lista de
                  consensos bajo el título "sobre qué se discute" haría pensar
                  que el mercado está dividido cuando no lo está — y lo
                  interesante para Content es justamente lo contrario: un tema
                  donde todos dicen lo mismo es un tema donde tomar la posición
                  contraria no tiene competencia.
                */}
                {!s.positions.some((p) => p.is_tension) ? (
                  <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
                    Ningún tema tiene los dos lados sostenidos por varias voces: en este
                    mercado hay consenso, no debate. Hace falta más volumen de posts para
                    detectar una tensión real.
                  </p>
                ) : null}
                <div className="space-y-2">
                  {s.positions.slice(0, 5).map((p) => (
                    <Tension key={p.object_label} position={p} />
                  ))}
                </div>
              </div>
            ) : null}

            {s.visual_mix?.length ? (
              <div className="mb-5">
                <SectionLabel>Cómo se ve lo que funciona</SectionLabel>
                {/*
                  A propósito NO se llama lift ni se compara contra una base:
                  el análisis del creativo corre solo sobre el corte superior,
                  así que no hay denominador. Esto compara entre los que
                  funcionaron, y decirlo importa — presentarlo como lift sería
                  afirmar algo que el dato no sostiene.
                */}
                <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
                  Sobre las piezas del corte superior que pudimos analizar visualmente. Es
                  una comparación entre las que funcionaron, no contra el resto del mercado.
                </p>
                <ul className="space-y-2">
                  {s.visual_mix.slice(0, 6).map((v) => (
                    <li
                      key={v.key}
                      className="flex items-baseline gap-2 text-[14px] leading-[1.4]"
                    >
                      <span className="min-w-0 flex-1 truncate">{v.key.replace(/_/g, " ")}</span>
                      <span className="shrink-0 tabular-nums text-[var(--muted)]">
                        {v.posts} posts · {v.authors} autores
                      </span>
                      {v.median_outlier ? (
                        <span className="shrink-0 font-semibold tabular-nums">
                          {v.median_outlier.toFixed(1)}×
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-6 sm:grid-cols-2">
              <LiftList title="Hooks que ganan" rows={s.winning_hooks ?? []} />
              <LiftList title="Temas que ganan" rows={s.winning_themes ?? []} />
              <LiftList title="Estructuras que ganan" rows={s.winning_structures ?? []} />
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
