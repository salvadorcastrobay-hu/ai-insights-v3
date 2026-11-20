import Link from "next/link";

import { PostMedia } from "@/components/PostMedia";
import { Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { loadOwnAds } from "@/lib/content/queries";
import type { OwnAd } from "@/lib/content/types";

export const dynamic = "force-dynamic";

/**
 * Ads propios: nuestros anuncios de Meta, leídos de las cuentas publicitarias
 * por la Graph API (ver humand-insights-web/lib/content/own-ads.ts).
 *
 * Una cuenta publicitaria a la vez: LATAM gasta en pesos y Brasil en dólares,
 * y sumar monedas distintas no da ningún número. El alcance no se suma entre
 * anuncios (una persona puede ver varios), así que no hay "alcance total".
 */

/** Para comparar costo por lead, un anuncio necesita unos cuantos leads. */
const MIN_LEADS = 5;

function money(n: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currencyDisplay: "code",
      currency: currency ?? "USD",
      notation: n >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: n >= 100_000 ? 1 : 0,
    }).format(n);
  } catch {
    return `${currency ?? ""} ${Math.round(n).toLocaleString("es-AR")}`;
  }
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 10_000) return `${Math.round(n / 1000)} k`;
  return n.toLocaleString("es-AR");
}

function pct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(2).replace(".", ",")}%`;
}

type Totals = { ads: number; spend: number; impressions: number; clicks: number; leads: number };

function totals(ads: OwnAd[]): Totals {
  return ads.reduce(
    (t, a) => ({
      ads: t.ads + 1,
      spend: t.spend + a.spend,
      impressions: t.impressions + a.impressions,
      clicks: t.clicks + a.clicks,
      leads: t.leads + a.leads,
    }),
    { ads: 0, spend: 0, impressions: 0, clicks: 0, leads: 0 },
  );
}

const ctr = (t: { clicks: number; impressions: number }) => (t.impressions ? t.clicks / t.impressions : null);
const cpl = (t: { spend: number; leads: number }) => (t.leads ? t.spend / t.leads : null);

/** Los nombres siguen una convención: objetivo_tipo_mercado_red_tema_embudo_idioma_país. */
function funnel(name: string | null): string | null {
  const m = /_(tof|mof|bof)_/i.exec(name ?? "");
  return m ? m[1].toUpperCase() : null;
}

function Stat({ value, name, hint }: { value: string; name: string; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[24px] font-semibold leading-[1.4] tabular-nums">{value}</p>
      <p className="text-[12px] leading-[1.4] text-[var(--faint)]">{name}</p>
    </div>
  );
}

function AdCard({ ad, currency }: { ad: OwnAd & { ads?: number }; currency: string | null }) {
  const text = ad.creative_title ?? ad.creative_body ?? ad.ad_name ?? "";
  return (
    <article className="flex flex-col overflow-hidden rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="relative aspect-square w-full overflow-hidden">
        <PostMedia src={ad.thumbnail_url} seed={ad.ad_id} text={text.slice(0, 110)} />
        {ad.status === "ACTIVE" ? (
          <span className="absolute left-2 top-2 rounded-[var(--r-s)] bg-white/90 px-2 py-0.5 text-[12px] leading-[1.4] text-[var(--text)]">
            activo
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="grid grid-cols-3 gap-2 border-b border-[var(--border)] pb-2">
          <div>
            <p className="text-[16px] font-semibold leading-[1.4] tabular-nums">{cpl(ad) != null ? money(cpl(ad)!, currency) : "—"}</p>
            <p className="text-[10px] uppercase leading-[1.4] text-[var(--faint)]">por lead</p>
          </div>
          <div>
            <p className="text-[16px] font-semibold leading-[1.4] tabular-nums">{ad.leads}</p>
            <p className="text-[10px] uppercase leading-[1.4] text-[var(--faint)]">leads</p>
          </div>
          <div>
            <p className="text-[16px] font-semibold leading-[1.4] tabular-nums">{pct(ctr(ad))}</p>
            <p className="text-[10px] uppercase leading-[1.4] text-[var(--faint)]">CTR</p>
          </div>
        </div>
        {ad.creative_title ? <h3 className="text-[14px] font-semibold leading-[1.4]">{ad.creative_title}</h3> : null}
        {ad.creative_body ? (
          <p className="line-clamp-4 whitespace-pre-line text-[14px] leading-[1.4] text-[var(--muted)]">{ad.creative_body}</p>
        ) : null}
        <p className="mt-auto pt-1 text-[12px] leading-[1.4] text-[var(--faint)]">
          {money(ad.spend, currency)}
          {ad.ads && ad.ads > 1 ? ` en ${ad.ads} anuncios` : ""} · {ad.campaign_name ?? "sin campaña"}
        </p>
        {ad.ig_permalink ? (
          <a
            href={ad.ig_permalink}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-semibold text-[var(--brand-ink)] hover:underline"
          >
            Ver la pieza ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default async function OwnAdsPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const { cuenta } = await searchParams;
  const all = await loadOwnAds().catch(() => [] as OwnAd[]);

  if (!all.length) {
    return (
      <>
        <PageHeader title="Ads propios" subtitle="Nuestros anuncios de Meta: cuánto invertimos, qué trajo y qué piezas rindieron." />
        <EmptyState
          title="Todavía no hay anuncios cargados"
          hint="Se cargan con la ingesta semanal, si la conexión de Meta tiene acceso a las cuentas publicitarias."
        />
      </>
    );
  }

  const accounts = [...new Map(all.map((a) => [a.ad_account_id, a])).values()]
    .map((a) => ({ id: a.ad_account_id, name: a.ad_account_name ?? a.ad_account_id, currency: a.currency, ...totals(all.filter((x) => x.ad_account_id === a.ad_account_id)) }))
    .sort((a, b) => b.ads - a.ads);
  const account = accounts.find((a) => a.id === cuenta) ?? accounts[0];
  const ads = all.filter((a) => a.ad_account_id === account.id);
  const period = { start: ads[0]?.period_start, end: ads[0]?.period_end };
  const t = totals(ads);

  const campaigns = [...new Map(ads.map((a) => [a.campaign_id ?? a.campaign_name ?? "—", a])).keys()]
    .map((id) => {
      const rows = ads.filter((a) => (a.campaign_id ?? a.campaign_name ?? "—") === id);
      return { id, name: rows[0].campaign_name ?? "—", active: rows.some((r) => r.status === "ACTIVE"), ...totals(rows) };
    })
    .sort((a, b) => b.spend - a.spend);

  // Una misma pieza corre en varios conjuntos de anuncios (públicos, países):
  // se agrupa por el post de Instagram que usa, para no verla repetida.
  const pieces = [...new Map(ads.map((a) => [a.ig_shortcode ?? a.ad_id, a])).keys()].map((k) => {
    const rows = ads.filter((a) => (a.ig_shortcode ?? a.ad_id) === k).sort((a, b) => b.spend - a.spend);
    return { ...rows[0], ...totals(rows), status: rows.some((r) => r.status === "ACTIVE") ? "ACTIVE" : rows[0].status };
  });
  const withLeads = pieces.filter((a) => a.leads >= MIN_LEADS);
  const cheapest = [...withLeads].sort((a, b) => (cpl(a) ?? Infinity) - (cpl(b) ?? Infinity)).slice(0, 6);
  const priciest = [...withLeads].sort((a, b) => (cpl(b) ?? 0) - (cpl(a) ?? 0)).slice(0, 3);
  const dateFmt = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" }) : "—");

  return (
    <>
      <PageHeader
        title="Ads propios"
        subtitle={`Nuestros anuncios de Meta del ${dateFmt(period.start)} al ${dateFmt(period.end)}: cuánto invertimos, qué trajo y qué piezas rindieron.`}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {accounts.map((a) => (
          <Link
            key={a.id}
            href={`/ads?cuenta=${a.id}`}
            aria-current={a.id === account.id ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-[12px] leading-[1.4] ${
              a.id === account.id
                ? "border-transparent bg-[var(--brand-soft-2)] font-semibold text-[var(--brand-deep)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]"
            }`}
          >
            {a.name} · {a.currency}
          </Link>
        ))}
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat value={money(t.spend, account.currency)} name="invertido" />
        <Stat value={count(t.impressions)} name="impresiones" />
        <Stat value={count(t.clicks)} name="clics" />
        <Stat value={pct(ctr(t))} name="CTR" hint="Clics sobre impresiones" />
        <Stat value={count(t.leads)} name="leads" hint="Leads atribuidos por Meta (formularios y píxel)" />
        <Stat value={cpl(t) != null ? money(cpl(t)!, account.currency) : "—"} name="costo por lead" />
      </Card>
      <p className="mt-2 text-[12px] leading-[1.4] text-[var(--faint)]">
        {t.ads} anuncios con impresiones en el período, {pieces.length} piezas distintas. Leads según la atribución de Meta: no son los mismos números que
        HubSpot.
      </p>

      <section className="mt-8">
        <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Las piezas que traen leads más baratos</h2>
        <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
          Entre las piezas con al menos {MIN_LEADS} leads, sumando todos los anuncios que la usaron. Sirven de referencia para la próxima pieza: qué dicen y cómo
          lo dicen.
        </p>
        {cheapest.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cheapest.map((ad) => (
              <AdCard key={ad.ad_id} ad={ad} currency={account.currency} />
            ))}
          </div>
        ) : (
          <EmptyState title="Ningún anuncio llegó a esa cantidad de leads" hint="Con pocos leads el costo por lead cambia mucho de una semana a otra." />
        )}
      </section>

      {priciest.length ? (
        <section className="mt-8">
          <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Las que salen más caras</h2>
          <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
            También con al menos {MIN_LEADS} leads. No siempre son malas: una pieza de fondo de embudo trae menos leads y
            mejores.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {priciest.map((ad) => (
              <AdCard key={ad.ad_id} ad={ad} currency={account.currency} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-[18px] font-semibold leading-[1.4]">Por campaña</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-[14px] leading-[1.4]">
            <thead className="bg-[var(--brand-soft)] text-[12px] text-[var(--brand-deep)]">
              <tr>
                <th className="px-4 py-2 font-semibold">Campaña</th>
                <th className="px-3 py-2 font-semibold">Embudo</th>
                <th className="px-3 py-2 text-right font-semibold">Invertido</th>
                <th className="px-3 py-2 text-right font-semibold">Impresiones</th>
                <th className="px-3 py-2 text-right font-semibold">CTR</th>
                <th className="px-3 py-2 text-right font-semibold">Leads</th>
                <th className="px-4 py-2 text-right font-semibold">Por lead</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.slice(0, 25).map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="max-w-[360px] truncate px-4 py-2" title={c.name}>
                    {c.active ? <span className="mr-1.5 inline-block size-2 rounded-full bg-[var(--success)]" title="Tiene anuncios activos" /> : null}
                    {c.name}
                  </td>
                  <td className="px-3 py-2 text-[var(--muted)]">{funnel(c.name) ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(c.spend, account.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(c.impressions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(ctr(c))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.leads}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{cpl(c) != null ? money(cpl(c)!, account.currency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {campaigns.length > 25 ? (
          <p className="mt-2 text-[12px] leading-[1.4] text-[var(--faint)]">
            Las 25 campañas con más inversión de {campaigns.length}.
          </p>
        ) : null}
      </section>

      <div className="mt-8">
        <SectionLabel>Cómo leer esto</SectionLabel>
        <Callout>
          Los anuncios salen con piezas hechas para pauta, no con posts del feed: por eso no se cruzan con Insights
          propios. Si algún día se pauta un post orgánico, ahí aparece marcado. LinkedIn Ads no está: pide aprobación de
          LinkedIn.
        </Callout>
      </div>
    </>
  );
}
