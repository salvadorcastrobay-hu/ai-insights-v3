import { Badge } from "@/components/ui";
import { PostMedia } from "@/components/PostMedia";
import type { ContentPost } from "@/lib/content/types";

/**
 * Tarjeta de post.
 *
 * Sofía escanea para contestar una sola pregunta: "¿esto lo puedo replicar?".
 * Eso se decide con cuatro datos —cuánto rindió, de qué va, por qué funcionó y
 * si nos sirve—, así que la tarjeta muestra siete campos de los veintiuno que
 * tiene el clasificador. El resto vive en el desplegable o no se muestra.
 *
 * La versión anterior volcaba diez campos como párrafos grises del mismo
 * tamaño: sin jerarquía, el ojo no tiene dónde aterrizar.
 */

function engagementTotal(post: ContentPost): number {
  return (post.likes_count ?? 0) + (post.comments_count ?? 0) + (post.shares_count ?? 0);
}

function platformLabel(platform: string): string {
  return platform === "linkedin" ? "LinkedIn" : "Instagram";
}

/**
 * El múltiplo sobre la propia media del autor: el dato que hace comparable a
 * una creadora de 500k con una marca de 5k, y la idea entera del producto.
 *
 * Va sobre la imagen y no en una caja aparte, para que no se lea como una
 * métrica abstracta: está tocando el post que describe. El número es grande y
 * la unidad chica, pero nunca se muestra el número sin la frase — "27" solo no
 * significa nada.
 */
function OutlierBadge({ value, engagement }: { value: number; engagement: number }) {
  const tone =
    value >= 10
      ? "bg-[var(--brand-solid)] text-white"
      : value >= 3
        ? "bg-[var(--brand-soft-2)] text-[var(--brand-deep)]"
        : "bg-white/90 text-[var(--text)]";

  return (
    <div
      className={`absolute left-2 top-2 rounded-[var(--r-m)] px-2 py-1 text-center shadow-[var(--shadow-4)] ${tone}`}
      title={`${engagement.toLocaleString("es")} interacciones en total`}
    >
      <div className="text-[20px] font-semibold leading-none tabular-nums">
        {value >= 10 ? Math.round(value) : value.toFixed(1)}
        <span className="text-[13px]">×</span>
      </div>
      <div className="mt-0.5 text-[10px] leading-[1.4] opacity-75">su promedio</div>
    </div>
  );
}

export function PostCard({
  post,
  rank,
  hero = false,
}: {
  post: ContentPost;
  rank: number;
  /** Los tres primeros van apaisados y con la foto arriba: el podio. */
  hero?: boolean;
}) {
  const a = post.analysis;
  const headline = a?.hook ?? post.caption?.slice(0, 110) ?? "(sin texto)";

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] transition-shadow hover:shadow-[var(--shadow-8)] ${
        hero ? "" : "sm:flex-row"
      }`}
    >
      {/*
        Ancho fijo y a propósito: la tarjeta mide igual con foto, sin foto o con
        la foto rota. Si el layout cambiara de forma según el media, la grilla
        se desarmaría sola cada vez que vence una tanda de URLs.
      */}
      <div
        className={`relative w-full shrink-0 overflow-hidden ${
          hero ? "aspect-[16/10]" : "aspect-[16/10] sm:aspect-auto sm:w-[176px]"
        }`}
      >
        <PostMedia
          src={post.image_url ?? null}
          seed={post.author_handle}
          text={headline}
        />
        {post.outlier_factor ? (
          <OutlierBadge value={post.outlier_factor} engagement={engagementTotal(post)} />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-[12px] leading-[1.4] text-[var(--faint)]">
          <span className="truncate font-semibold text-[var(--text)]">@{post.author_handle}</span>
          <span aria-hidden>·</span>
          <span>{platformLabel(post.platform)}</span>
          {post.posted_at ? (
            <>
              <span aria-hidden>·</span>
              <time dateTime={post.posted_at}>
                {new Date(post.posted_at).toLocaleDateString("es", {
                  day: "numeric",
                  month: "short",
                })}
              </time>
            </>
          ) : null}
          <span className="ml-auto shrink-0 tabular-nums">#{rank}</span>
        </div>

        <h3 className="text-[18px] font-semibold leading-[1.4] text-[var(--text)]">{headline}</h3>

        {a?.why_it_worked ? (
          <p className="border-l-2 border-[var(--border-strong)] pl-3 text-[14px] leading-[1.4] text-[var(--muted)]">
            {a.why_it_worked}
          </p>
        ) : null}

        {/* La única caja de color de la tarjeta, porque es el puente a la acción. */}
        {a?.humand_angle ? (
          <p className="rounded-[var(--r-m)] bg-[var(--brand-soft)] px-3 py-2 text-[14px] leading-[1.4] text-[var(--brand-deep)]">
            <span className="font-semibold">Para Humand · </span>
            {a.humand_angle}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {a?.hook_pattern ? <Badge tone="brand">{a.hook_pattern}</Badge> : null}
          {a?.theme ? <Badge tone="muted">{a.theme.replace(/_/g, " ")}</Badge> : null}
          {post.post_url ? (
            <a
              href={post.post_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[12px] font-semibold text-[var(--brand-ink)] hover:underline"
            >
              Ver el post ↗
            </a>
          ) : null}
        </div>

        {/* <details> nativo: cero JS y funciona dentro de un server component. */}
        {a?.development || a?.cta ? (
          <details className="group">
            <summary className="cursor-pointer list-none text-[12px] leading-[1.4] text-[var(--faint)] hover:text-[var(--text)]">
              <span className="group-open:hidden">Ver desarrollo y CTA</span>
              <span className="hidden group-open:inline">Ocultar</span>
            </summary>
            <div className="mt-2 space-y-1 text-[14px] leading-[1.4] text-[var(--muted)]">
              {a.development ? <p>{a.development}</p> : null}
              {a.cta ? (
                <p>
                  <span className="font-semibold">CTA · </span>
                  {a.cta}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}
