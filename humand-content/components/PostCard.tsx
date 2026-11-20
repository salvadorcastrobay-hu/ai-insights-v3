import { FullImage } from "@/components/FullImage";
import { PostMedia } from "@/components/PostMedia";
import { label } from "@/lib/content/labels";
import { regionLabel, type ContentPost } from "@/lib/content/types";
import type { OwnClue } from "@/lib/content/own";
import type { WhyItWorked } from "@/lib/content/why";

/**
 * Tarjeta de post, con las métricas primero.
 *
 * Lo que pidió Sofía en la llamada del 23/10, en orden:
 * 1. Los KPIs arriba. "22× su promedio" no decía 22 veces QUÉ; acá el múltiplo
 *    dice que es engagement y al lado están los números que lo forman.
 * 2. El tema, para ver qué tópicos se repiten.
 * 3. La postura, que ya le servía.
 * 4. Por qué pudo funcionar: lo que el post comparte con lo que más rinde en
 *    su mercado, con el número (ver lib/content/why.ts).
 * 5. Cómo inspirarse: "me cuesta entender cómo me inspiro de esto". Se arma
 *    en código con lo que ya está clasificado —formato, apertura, mecanismo,
 *    respaldo—, sin pedirle nada nuevo al modelo: son las piezas que se pueden
 *    copiar sin copiar el tema.
 */

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(".0", "")}k`;
  return n.toLocaleString("es-AR");
}

function Kpi({ value, name, hint }: { value: string; name: string; hint?: string }) {
  return (
    <div title={hint} className="min-w-0">
      <div className="text-[16px] font-semibold leading-[1.4] tabular-nums text-[var(--text)]">{value}</div>
      <div className="text-[10px] uppercase leading-[1.4] text-[var(--faint)]">{name}</div>
    </div>
  );
}

/**
 * Las piezas transferibles del post, en frases que se pueden leer como instrucción.
 * `skip` son ejes que ya dijo "Por qué pudo funcionar", para no repetirlos.
 */
export function takeaways(post: ContentPost, skip: ReadonlySet<string> = new Set()): string[] {
  const a = post.analysis;
  const f = post.features;
  const out: string[] = [];
  if (f?.format_detail && !skip.has("format")) {
    const detail =
      f.slide_count && f.slide_count > 1
        ? ` de ${f.slide_count} placas`
        : f.video_length
          ? ` de ${f.video_length}`
          : "";
    out.push(`Formato: ${label(f.format_detail).toLowerCase()}${detail}.`);
  }
  if (a?.hook_pattern && a.hook_pattern !== "otro") out.push(`Arranca con ${label(a.hook_pattern)}.`);
  if (a?.transferable_mechanism && a.transferable_mechanism !== "ninguno") {
    // "Recurso" y no "funciona porque": el mecanismo lo infiere el modelo y no
    // está medido como causa.
    out.push(`Recurso: ${label(a.transferable_mechanism)}.`);
  }
  if (a?.evidence_type && a.evidence_type !== "ninguna" && !skip.has("evidence")) out.push(`Se apoya en ${label(a.evidence_type)}.`);
  return out;
}

function lift(n: number): string {
  // Redondeo explícito: toFixed sobre 1,45 da 1,4 por la representación binaria
  // y 2,25 da 2,3; el epsilon hace que los dos redondeen igual.
  return `${(Math.round(n * 10 + 1e-9) / 10).toFixed(1).replace(".", ",")}×`;
}

function WhyBox({ why }: { why: WhyItWorked }) {
  const market = regionLabel(why.region);
  return (
    <div className="rounded-[var(--r-m)] bg-[var(--surface-sunk)] px-3 py-2">
      <p className="text-[12px] font-semibold leading-[1.4] text-[var(--text)]">Por qué pudo funcionar</p>
      {why.reasons.length ? (
        <>
          <p className="mb-1 text-[12px] leading-[1.4] text-[var(--faint)]">
            Lo que tiene en común con los posts que más rinden en {market}
          </p>
          <ul className="space-y-0.5">
            {why.reasons.map((r) => (
              <li
                key={r.text}
                className="flex items-baseline justify-between gap-3 text-[14px] leading-[1.4] text-[var(--muted)]"
              >
                <span>{r.text}</span>
                <span
                  className="shrink-0 font-semibold tabular-nums text-[var(--brand-deep)]"
                  title={`Entre los posts que más rinden en ${market} esto aparece ${lift(r.lift)} más que en el total del mercado`}
                >
                  {lift(r.lift)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
          Nada de lo que tiene se destaca entre lo que más rinde en {market}: el resultado puede venir de la cuenta,
          del momento o del tema puntual.
        </p>
      )}
    </div>
  );
}

/**
 * Para nuestros posts: no se explican contra el mercado sino contra el resto
 * de nuestra cuenta, y son pistas (ver lib/content/own.ts). Por eso conteos y
 * no múltiplos.
 */
export type OwnClues = {
  works: boolean;
  tercile: number;
  items: OwnClue[];
  /** Si viene, no hay pistas para este post y se dice por qué. */
  unavailable?: string;
};

function ClueBox({ clues }: { clues: OwnClues }) {
  return (
    <div className="rounded-[var(--r-m)] bg-[var(--surface-sunk)] px-3 py-2">
      <p className="text-[12px] font-semibold leading-[1.4] text-[var(--text)]">
        {clues.works ? "Pistas de por qué rindió" : "Pistas de por qué no rindió"}
      </p>
      {clues.unavailable ? (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">{clues.unavailable}</p>
      ) : clues.items.length ? (
        <>
          <p className="mb-1 text-[12px] leading-[1.4] text-[var(--faint)]">
            Lo que tiene y se repite en {clues.works ? "nuestros posts que más rindieron" : "los que menos rindieron"}
          </p>
          <ul className="space-y-0.5">
            {clues.items.map((c) => (
              <li
                key={c.text}
                className="flex items-baseline justify-between gap-3 text-[14px] leading-[1.4] text-[var(--muted)]"
              >
                <span>{c.text}</span>
                <span
                  className="shrink-0 tabular-nums text-[12px] text-[var(--faint)]"
                  title={`De nuestros ${clues.tercile} posts de Instagram que más rindieron, ${c.inTop} lo tienen; de los ${clues.tercile} que menos, ${c.inBottom}`}
                >
                  {c.inTop} vs {c.inBottom}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
          No tiene ninguno de los rasgos que se repiten en {clues.works ? "lo que más" : "lo que menos"} nos rinde: el
          resultado puede venir del tema puntual, del momento o de la pauta.
        </p>
      )}
    </div>
  );
}

export function PostCard({
  post,
  why,
  clues,
  compactLayout = false,
}: {
  post: ContentPost;
  /** Null u omitido: no se muestra (post fuera de RRHH o mercado sin síntesis). */
  why?: WhyItWorked | null;
  /** Solo para nuestros posts; reemplaza a `why`. */
  clues?: OwnClues | null;
  compactLayout?: boolean;
}) {
  const a = post.analysis;
  const headline = a?.hook ?? post.caption?.slice(0, 110) ?? "(sin texto)";
  const tips = takeaways(post, new Set(why?.reasons.map((r) => r.axis)));
  const isReel = post.features?.format_detail === "reel" || post.features?.format_detail === "video";

  return (
    <article className="flex flex-col overflow-hidden rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] transition-shadow hover:shadow-[var(--shadow-8)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <PostMedia src={post.image_url ?? null} seed={post.author_handle} text={headline} />
        <span className="absolute left-2 top-2 rounded-[var(--r-s)] bg-white/90 px-2 py-0.5 text-[12px] leading-[1.4] text-[var(--text)]">
          {post.platform === "linkedin" ? "LinkedIn" : "Instagram"}
          {post.features?.format_detail ? ` · ${label(post.features.format_detail)}` : ""}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-[12px] leading-[1.4] text-[var(--faint)]">
          <span className="truncate font-semibold text-[var(--text)]">@{post.author_handle}</span>
          {post.posted_at ? (
            <>
              <span aria-hidden>·</span>
              <time dateTime={post.posted_at}>
                {new Date(post.posted_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
              </time>
            </>
          ) : null}
        </div>

        {/* El múltiplo, con unidad y comparación dichas. */}
        {post.outlier_factor ? (
          <div className="rounded-[var(--r-m)] bg-[var(--brand-soft)] px-3 py-2">
            <p className="text-[14px] leading-[1.4] text-[var(--brand-deep)]">
              <span className="text-[18px] font-semibold tabular-nums">
                {post.outlier_factor >= 10 ? Math.round(post.outlier_factor) : post.outlier_factor.toFixed(1)}×
              </span>{" "}
              el engagement habitual de esta cuenta
            </p>
          </div>
        ) : null}

        {/*
          Collab y "pide comentar" explican el número antes de que alguien lo
          copie: el primero tomó alcance prestado de otra cuenta, el segundo
          juntó comentarios por pedido. Ninguno de los dos es el contenido.
        */}
        {post.features?.is_collab || post.features?.comment_bait || post.promoted ? (
          <div className="flex flex-wrap gap-2">
            {post.promoted ? (
              <span
                className="rounded-[var(--r-s)] border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 text-[12px] leading-[1.4] text-[var(--warn-text)]"
                title={`Lo usaron ${post.promoted.ads} anuncio${post.promoted.ads === 1 ? "" : "s"} nuestro${post.promoted.ads === 1 ? "" : "s"} en los últimos 90 días: parte del alcance es pago.`}
              >
                pautado: no se compara con los orgánicos
              </span>
            ) : null}
            {post.features?.is_collab ? (
              <span
                className="rounded-[var(--r-s)] border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 text-[12px] leading-[1.4] text-[var(--warn-text)]"
                title="Publicado en colaboración con otra cuenta: suma las dos audiencias."
              >
                collab: suma la audiencia de otra cuenta
              </span>
            ) : null}
            {post.features?.comment_bait ? (
              <span
                className="rounded-[var(--r-s)] border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 text-[12px] leading-[1.4] text-[var(--warn-text)]"
                title="Pide comentar una palabra a cambio de algo: los comentarios son pedidos, no debate."
              >
                pide comentar una palabra
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-2 border-b border-[var(--border)] pb-3">
          <Kpi value={compact(post.likes_count)} name="likes" />
          <Kpi value={compact(post.comments_count)} name="coment." />
          {isReel ? (
            <Kpi value={compact(post.video_views)} name="reprod." />
          ) : (
            <Kpi
              value={post.platform === "linkedin" || post.native_insights ? compact(post.shares_count) : "—"}
              name="compart."
              hint={
                post.platform === "instagram" && !post.native_insights
                  ? "Instagram no muestra los compartidos desde afuera; solo los vemos en nuestras cuentas"
                  : undefined
              }
            />
          )}
          <Kpi
            value={post.engagement_rate != null ? `${(post.engagement_rate * 100).toFixed(1)}%` : "—"}
            name="eng. rate"
            hint={
              post.engagement_rate == null
                ? "LinkedIn no expone seguidores: no hay tasa"
                : "Interacciones sobre seguidores de la cuenta"
            }
          />
        </div>

        {/* Solo nuestras cuentas leídas por Meta: lo que el scraping no ve. */}
        {post.native_insights ? (
          <div className="-mt-1 grid grid-cols-4 gap-2 border-b border-[var(--border)] pb-3">
            <Kpi value={compact(post.native_insights.reach)} name="alcance" hint="Cuentas distintas que lo vieron (Meta)" />
            <Kpi value={compact(post.native_insights.saved)} name="guardados" />
            {/* Lo que la fila de arriba no muestra ya: en reels, compartidos; en el resto, vistas. */}
            {isReel ? (
              <Kpi value={compact(post.native_insights.shares)} name="compart." />
            ) : (
              <Kpi value={compact(post.native_insights.views)} name="vistas" hint="Veces que se mostró (Meta)" />
            )}
            <Kpi
              value={
                post.native_insights.reach && post.native_insights.total_interactions != null
                  ? `${((post.native_insights.total_interactions / post.native_insights.reach) * 100).toFixed(1)}%`
                  : "—"
              }
              name="eng. / alcance"
              hint="Interacciones sobre las cuentas que lo vieron: más justo que sobre seguidores"
            />
          </div>
        ) : null}

        {a?.theme && a.theme !== "otro" ? (
          <p className="text-[12px] font-semibold uppercase leading-[1.4] text-[var(--brand-ink)]">{label(a.theme)}</p>
        ) : null}

        <h3 className="text-[16px] font-semibold leading-[1.4] text-[var(--text)]">{headline}</h3>

        {a?.claim && !compactLayout ? (
          <p className="text-[14px] leading-[1.4] text-[var(--muted)]">{a.claim}</p>
        ) : null}

        {clues ? <ClueBox clues={clues} /> : why ? <WhyBox why={why} /> : null}

        {/* "Qué podés tomar" es para inspirarse en otros; en lo nuestro no aplica. */}
        {tips.length && !clues ? (
          <div className="rounded-[var(--r-m)] border border-[var(--border)] px-3 py-2">
            <p className="mb-1 text-[12px] font-semibold leading-[1.4] text-[var(--text)]">Qué podés tomar</p>
            <ul className="space-y-0.5">
              {tips.map((t) => (
                <li key={t} className="text-[14px] leading-[1.4] text-[var(--muted)]">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-3 pt-1">
          {(post.caption && post.caption.length > 120) || post.image_url ? (
            <details className="group/copy min-w-0 flex-1">
              <summary className="cursor-pointer list-none text-[12px] font-semibold leading-[1.4] text-[var(--brand-ink)] hover:underline">
                <span className="group-open/copy:hidden">Ver la pieza completa</span>
                <span className="hidden group-open/copy:inline">Ocultar</span>
              </summary>
              {post.image_url ? <FullImage src={post.image_url} /> : null}
              {post.caption ? (
                <p className="mt-2 whitespace-pre-wrap rounded-[var(--r-m)] bg-[var(--surface-sunk)] p-3 text-[14px] leading-[1.4] text-[var(--text)]">
                  {post.caption}
                </p>
              ) : null}
            </details>
          ) : (
            <span className="flex-1" />
          )}
          {post.post_url ? (
            <a
              href={post.post_url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Ver el post de @${post.author_handle}`}
              className="shrink-0 text-[12px] font-semibold text-[var(--brand-ink)] hover:underline"
            >
              Ver el post ↗
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
