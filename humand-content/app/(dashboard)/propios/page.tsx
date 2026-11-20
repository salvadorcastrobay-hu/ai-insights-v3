import Link from "next/link";

import { OwnBrand } from "@/components/OwnBrand";
import { PostCard } from "@/components/PostCard";
import { Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { cluesFor, ownContrast, type OwnClue } from "@/lib/content/own";
import { loadOwnBrandComparisons, loadOwnPosts, type OwnAccount } from "@/lib/content/queries";
import type { ContentPost } from "@/lib/content/types";

export const dynamic = "force-dynamic";

/**
 * Insights propios: nuestros posts, qué funcionó, qué no y por qué.
 *
 * Una cuenta a la vez. Antes se mezclaban: con @humand.br (en portugués, para
 * Brasil) las pistas de Instagram habrían comparado posts de dos audiencias
 * distintas como si fueran una.
 *
 * Cada post se mide igual que los de otros, contra el promedio de su propia
 * cuenta. El "por qué" tiene dos fuentes de distinto peso, y la página las
 * separa: las pistas salen de comparar nuestros posts entre sí (decenas, así
 * que son pistas), y "Contra el rubro" sale de los patrones del mercado.
 *
 * Lo pautado se saca del ranking y de las pistas: si un anuncio usó el post,
 * su múltiplo junta alcance pago.
 */

const SHOWN = 5;

const MARKETS = [
  { value: "hispam", label: "HISPAM" },
  { value: "br", label: "Brasil" },
  { value: "es", label: "España" },
];

/** El mercado natural de cada cuenta, para abrir "Contra el rubro" ahí. */
const ACCOUNT_MARKET: Record<string, string> = { "humand.br": "br" };

const key = (a: { platform: string; handle: string }) => `${a.platform}:${a.handle}`;

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("es-AR");
}

function AccountTab({ account, active, region }: { account: OwnAccount; active: boolean; region?: string }) {
  const network = account.platform === "linkedin" ? "LinkedIn" : "Instagram";
  const href = `/propios?cuenta=${encodeURIComponent(key(account))}${region ? `&region=${region}` : ""}`;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-[var(--r-l)] border p-4 transition-shadow ${
        active
          ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[var(--shadow-4)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:shadow-[var(--shadow-8)]"
      }`}
    >
      <p className="text-[12px] uppercase leading-[1.4] text-[var(--faint)]">{network}</p>
      <p className="text-[16px] font-semibold leading-[1.4]">@{account.handle}</p>
      <p className="mt-1 text-[12px] leading-[1.4] text-[var(--muted)]">
        {account.posts} posts · {account.followers != null ? `${account.followers.toLocaleString("es-AR")} seguidores` : "seguidores —"}
      </p>
    </Link>
  );
}

function AccountSummary({ account, posts }: { account: OwnAccount; posts: ContentPost[] }) {
  // Sin una veintena de posts no hay promedio estable contra el cual medir.
  const enough = account.measured >= 20;
  const native = posts.map((p) => p.native_insights).filter((n): n is NonNullable<typeof n> => Boolean(n));
  const nums = (pick: (n: (typeof native)[number]) => number | null) =>
    native.map(pick).filter((v): v is number => v != null);
  const rates = native
    .filter((n) => n.reach && n.total_interactions != null)
    .map((n) => (n.total_interactions as number) / (n.reach as number));
  const medRate = median(rates);

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[18px] font-semibold leading-[1.4] tabular-nums">{fmt(account.medianEngagement)}</p>
          <p className="text-[12px] leading-[1.4] text-[var(--faint)]">interacciones por post (mediana)</p>
        </div>
        {native.length ? (
          <>
            <div>
              <p className="text-[18px] font-semibold leading-[1.4] tabular-nums">{fmt(median(nums((n) => n.reach)))}</p>
              <p className="text-[12px] leading-[1.4] text-[var(--faint)]">alcance por post (mediana)</p>
            </div>
            <div>
              <p className="text-[18px] font-semibold leading-[1.4] tabular-nums">
                {fmt(median(nums((n) => n.saved)))} / {fmt(median(nums((n) => n.shares)))}
              </p>
              <p className="text-[12px] leading-[1.4] text-[var(--faint)]">guardados / compartidos (mediana)</p>
            </div>
            <div>
              <p className="text-[18px] font-semibold leading-[1.4] tabular-nums">
                {medRate != null ? `${(medRate * 100).toFixed(1).replace(".", ",")}%` : "—"}
              </p>
              <p className="text-[12px] leading-[1.4] text-[var(--faint)]">interacciones sobre alcance (mediana)</p>
            </div>
          </>
        ) : (
          <div className="col-span-1 sm:col-span-3">
            <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
              {account.platform === "instagram"
                ? "Sin alcance, guardados ni compartidos: esta cuenta no está compartida con la conexión de Meta, así que se lee desde afuera, como las de otros."
                : "LinkedIn no da alcance desde afuera. Se puede sumar con la API de páginas de LinkedIn, que pide aprobación."}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] leading-[1.4] text-[var(--muted)]">
        {enough
          ? `Del ${day(account.firstPost)} al ${day(account.lastPost)}.`
          : `Solo ${account.measured} posts medidos: todavía no alcanza para medir cuánto rinde cada uno contra el promedio de la cuenta.`}
        {native.length ? " Alcance, guardados y compartidos vienen de Meta." : ""}
      </p>
    </Card>
  );
}

function ClueList({ title, clues, tercile, works }: { title: string; clues: OwnClue[]; tercile: number; works: boolean }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      {clues.length ? (
        <ul className="space-y-1.5">
          {clues.map((c) => (
            <li key={`${c.axis}:${c.key}`} className="flex items-baseline justify-between gap-3 text-[14px] leading-[1.4]">
              <span>{c.text}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">
                {works ? c.inTop : c.inBottom} de los {tercile} {works ? "mejores" : "peores"} ·{" "}
                {works ? c.inBottom : c.inTop} de los {tercile} {works ? "peores" : "mejores"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">Nada se repite lo suficiente para marcarlo.</p>
      )}
    </div>
  );
}

export default async function OwnInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; cuenta?: string }>;
}) {
  const { region: askedRegion, cuenta } = await searchParams;
  const [{ posts, accounts }, comparisons] = await Promise.all([
    loadOwnPosts(),
    loadOwnBrandComparisons().catch(() => []),
  ]);

  if (!posts.length || !accounts.length) {
    return (
      <>
        <PageHeader title="Insights propios" subtitle="Nuestros posts, qué funcionó, qué no y por qué." />
        <EmptyState title="Todavía no hay posts nuestros" hint="Se cargan con la próxima corrida de ingesta." />
      </>
    );
  }

  // Por defecto, la cuenta de Instagram con más seguidores (hoy @humand.es).
  const byFollowers = (a: OwnAccount, b: OwnAccount) => (b.followers ?? 0) - (a.followers ?? 0);
  const account =
    accounts.find((a) => key(a) === cuenta) ??
    accounts.filter((a) => a.platform === "instagram").sort(byFollowers)[0] ??
    accounts[0];
  const mine = posts.filter((p) => p.platform === account.platform && p.author_handle === account.handle);
  const region = MARKETS.some((m) => m.value === askedRegion)
    ? askedRegion!
    : ACCOUNT_MARKET[account.handle] ?? "hispam";

  const promoted = mine.filter((p) => p.promoted);
  const organic = mine.filter((p) => !p.promoted);
  const ranked = organic
    .filter((p) => p.outlier_factor != null)
    .sort((a, b) => (b.outlier_factor ?? 0) - (a.outlier_factor ?? 0));
  const shown = Math.min(SHOWN, Math.floor(ranked.length / 2));
  const best = ranked.slice(0, shown);
  const worst = shown ? ranked.slice(-shown).reverse() : [];

  // Las pistas son de Instagram: un post de LinkedIn no se compara rasgo por
  // rasgo, y ahí hay pocos.
  const isInstagram = account.platform === "instagram";
  const contrast = ownContrast(isInstagram ? organic : []);
  const cluesOf = (post: ContentPost, works: boolean) =>
    isInstagram
      ? { works, tercile: contrast.tercile, items: cluesFor(post, works ? contrast.works : contrast.fails) }
      : {
          works,
          tercile: contrast.tercile,
          items: [],
          unavailable: "Las pistas salen de comparar nuestros posts de Instagram. En LinkedIn todavía hay pocos para compararlos entre sí.",
        };
  const comparison = comparisons.find((c) => c.region === region)?.comparison;

  return (
    <>
      <PageHeader
        title="Insights propios"
        subtitle="Nuestros posts, qué funcionó, qué no y por qué. Cada post se mide contra el promedio de su propia cuenta, igual que los de otros."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[...accounts].sort((a, b) => (a.platform === b.platform ? byFollowers(a, b) : a.platform === "instagram" ? -1 : 1)).map((a) => (
          <AccountTab key={key(a)} account={a} active={key(a) === key(account)} />
        ))}
      </div>

      <div className="mt-4">
        <AccountSummary account={account} posts={mine} />
      </div>
      {comparison?.reference_median_engagement != null ? (
        <p className="mt-2 text-[12px] leading-[1.4] text-[var(--faint)]">
          Para comparar: los referentes que seguimos en {MARKETS.find((m) => m.value === region)?.label} tienen una
          mediana de {comparison.reference_median_engagement} interacciones por post.
        </p>
      ) : null}

      {isInstagram ? (
        <div className="mt-4">
          <Callout>
            {promoted.length
              ? `${promoted.length} de estos posts los usó algún anuncio nuestro en los últimos 90 días: quedan afuera del ranking y de las pistas, porque parte de su alcance es pago.`
              : "Ninguno de estos posts lo usó un anuncio nuestro en los últimos 90 días: los anuncios de Meta salen con piezas propias, no con posts del feed. Lo que se ve acá es orgánico."}{" "}
            Los datos llegan hasta el {day(account.lastPost)}.
          </Callout>
        </div>
      ) : null}

      {shown ? (
        <>
          <section className="mt-8">
            <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Lo que mejor funcionó</h2>
            <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
              Los {shown} posts de @{account.handle} que más superaron su engagement habitual.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {best.map((post) => (
                <PostCard key={post.id} post={post} clues={cluesOf(post, true)} />
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Lo que menos funcionó</h2>
            <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
              Los {shown} que más quedaron por debajo de su engagement habitual.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {worst.map((post) => (
                <PostCard key={post.id} post={post} clues={cluesOf(post, false)} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="mt-8">
          <EmptyState
            title="Todavía no hay posts medidos de esta cuenta"
            hint="Hace falta una línea base de la cuenta para saber cuáles rindieron más o menos que lo habitual."
          />
        </div>
      )}

      {isInstagram ? (
        <section className="mt-8">
          <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Por qué: pistas de @{account.handle}</h2>
          <p className="mb-3 max-w-[760px] text-[14px] leading-[1.4] text-[var(--muted)]">
            Comparamos el tercio de sus posts que más rindió con el tercio que menos. Son pistas, no conclusiones: con{" "}
            {organic.length} posts, parte de estas diferencias puede ser casualidad. Sirven para probar, no para decidir
            solas.
          </p>
          <Card className="grid gap-6 p-4 sm:grid-cols-2">
            <ClueList title="Se repite en lo que más rindió" clues={contrast.works} tercile={contrast.tercile} works />
            <ClueList title="Se repite en lo que menos rindió" clues={contrast.fails} tercile={contrast.tercile} works={false} />
          </Card>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-1 text-[18px] font-semibold leading-[1.4]">Contra el rubro</h2>
        <p className="mb-3 max-w-[760px] text-[14px] leading-[1.4] text-[var(--muted)]">
          Qué patrones rinden entre los referentes de cada mercado y cuánto los usamos. Esto sale de miles de posts del
          mercado, así que tiene más respaldo que las pistas de arriba. Cada mercado se compara con su cuenta: Brasil
          con @humand.br, HISPAM y España con @humand.es, y LinkedIn entra en todos.
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {MARKETS.map((m) => (
            <a
              key={m.value}
              href={`/propios?cuenta=${encodeURIComponent(key(account))}&region=${m.value}`}
              aria-current={region === m.value ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-[12px] leading-[1.4] ${
                region === m.value
                  ? "border-transparent bg-[var(--brand-soft-2)] font-semibold text-[var(--brand-deep)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]"
              }`}
            >
              {m.label}
            </a>
          ))}
        </div>
        <Card className="p-4">
          {comparison ? (
            <OwnBrand cmp={comparison} />
          ) : (
            <p className="text-[14px] leading-[1.4] text-[var(--muted)]">Todavía no hay comparación para este mercado.</p>
          )}
        </Card>
      </section>
    </>
  );
}
