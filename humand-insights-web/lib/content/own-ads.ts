/**
 * Nuestros anuncios de Meta: métricas por anuncio de las cuentas publicitarias
 * activas, guardadas en content_own_ads.
 *
 * Se reescribe la ventana entera en cada corrida: Meta corrige las métricas de
 * días pasados (atribución tardía), así que una foto vieja no se completa, se
 * reemplaza. Los anuncios que salieron de la ventana se borran.
 *
 * Es gratis (Graph API, sin Apify) y no depende de ningún tope.
 */
import { fetchAdInsights, fetchAdsMeta, listAdAccounts, metaToken, toOwnAdRow, type OwnAdRow } from "./meta";
import { archiveOwnAdThumbnails } from "./own-ad-media";
import { getSupabaseAdmin } from "./store";

export const ADS_WINDOW_DAYS = 90;

export type OwnAdsResult = {
  accounts: Array<{ id: string; name: string; ads: number; spend: number; currency: string; error?: string }>;
};

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function refreshOwnAds(now = new Date(), days = ADS_WINDOW_DAYS): Promise<OwnAdsResult> {
  if (!metaToken()) return { accounts: [] };
  const sb = getSupabaseAdmin();
  const period = { since: day(new Date(now.getTime() - days * 86_400_000)), until: day(now) };
  const result: OwnAdsResult = { accounts: [] };

  for (const account of await listAdAccounts()) {
    try {
      const insights = await fetchAdInsights(account.id, period.since, period.until);
      // Cuentas activas sin gasto en la ventana (ej. la personal) no se guardan.
      if (!insights.length) continue;
      const meta = await fetchAdsMeta(insights.map((r) => r.ad_id));
      const rows: OwnAdRow[] = insights.map((r) => toOwnAdRow(account, r, meta.get(r.ad_id), period));
      // Las URLs de Meta vencen en días: se guardan las imágenes, no las URLs.
      await archiveOwnAdThumbnails(sb, rows);

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("content_own_ads").upsert(rows.slice(i, i + 500), { onConflict: "ad_id" });
        if (error) throw error;
      }
      // Lo que ya no tuvo impresiones en la ventana sale.
      const { error: pruneError } = await sb
        .from("content_own_ads")
        .delete()
        .eq("ad_account_id", account.id)
        .lt("fetched_at", rows[0].fetched_at);
      if (pruneError) throw pruneError;

      result.accounts.push({
        id: account.id,
        name: account.name,
        ads: rows.length,
        spend: Math.round(rows.reduce((s, r) => s + r.spend, 0)),
        currency: account.currency,
      });
    } catch (err) {
      result.accounts.push({
        id: account.id,
        name: account.name,
        ads: 0,
        spend: 0,
        currency: account.currency,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  return result;
}
