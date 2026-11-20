import { EmptyState, PageHeader } from "@/components/ui";
import { PostCard } from "@/components/PostCard";
import { FORMAT_GROUPS } from "@/lib/content/labels";
import { loadOwnHandles, loadRankedPosts, loadSyntheses } from "@/lib/content/queries";
import { whyItWorked } from "@/lib/content/why";

export const dynamic = "force-dynamic";

type Option = { value: string; label: string; soon?: boolean };

/*
 * Argentina y México salen del país de cada cuenta (content_authors.country);
 * "Resto de HISPAM" es hispam sin ellas.
 */
const REGIONS: Option[] = [
  { value: "", label: "Todos" },
  { value: "br", label: "Brasil" },
  { value: "es", label: "España" },
  { value: "ar", label: "Argentina" },
  { value: "mx", label: "México" },
  { value: "hispam", label: "Resto de HISPAM" },
];

const REGION_NAMES: Record<string, string> = { ar: "Argentina", mx: "México" };

/*
 * Audiencias de la reclasificación (content_posts.audience). Pymes sigue
 * apagada: 5 posts de 4 cuentas en toda la base, porque las cuentas que
 * seguimos son de RRHH y casi no le hablan a ese público. Se prende cuando
 * sumemos fuentes.
 */
const AUDIENCES: Option[] = [
  { value: "rrhh", label: "RRHH" },
  { value: "empleados", label: "Empleados" },
  { value: "management_ceo", label: "Management / CEO" },
  { value: "pymes", label: "Pymes", soon: true },
  { value: "candidatos", label: "Quien busca trabajo" },
  { value: "", label: "Todas" },
];

/** Links guardados con los valores de antes de la reclasificación. */
const OLD_AUDIENCES: Record<string, string> = { hr_leader: "rrhh", candidate: "candidatos", management: "management_ceo" };

const PLATFORMS: Option[] = [
  { value: "", label: "Todas" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
];

const FORMATS: Option[] = [{ value: "", label: "Todos" }, ...FORMAT_GROUPS.map((g) => ({ value: g.key, label: g.label }))];

/*
 * "Discusión" no se entendía (feedback: "llamarlo engagement"). Las dos
 * opciones ahora dicen qué ordenan: cuánto superó el post a su cuenta, o
 * cuánto más se comentó de lo habitual.
 */
const ORDERS: Option[] = [
  { value: "", label: "Más engagement" },
  { value: "debate", label: "Más comentarios" },
];

type Params = { region?: string; audience?: string; platform?: string; format?: string; sortBy?: string };

function FilterGroup({
  label,
  options,
  current,
  build,
}: {
  label: string;
  options: Option[];
  current: string;
  build: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-[88px] shrink-0 text-[12px] uppercase leading-[1.4] text-[var(--faint)]">{label}</span>
      {options.map((option) =>
        option.soon ? (
          <span
            key={option.value}
            title="Próximamente"
            className="cursor-not-allowed rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-[12px] leading-[1.4] text-[var(--faint)]"
          >
            {option.label}
          </span>
        ) : (
          <a
            key={option.value}
            href={build(option.value)}
            // El rótulo del grupo se ve pero no está asociado: sin esto hay
            // varios links "Todas" indistinguibles para un lector de pantalla.
            aria-label={`${label}: ${option.label}`}
            aria-current={current === option.value ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-[12px] leading-[1.4] transition-colors ${
              current === option.value
                ? "border-transparent bg-[var(--brand-soft-2)] font-semibold text-[var(--brand-deep)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]"
            }`}
          >
            {option.label}
          </a>
        ),
      )}
    </div>
  );
}

export default async function InspirationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const region = params.region ?? "";
  const platform = params.platform ?? "";
  const format = params.format ?? "";
  const sortBy = params.sortBy === "debate" ? "debate" : "";
  // Por defecto, RRHH: un post que explota entre quienes buscan trabajo enseña
  // formato, pero su tema no sirve para el calendario.
  const audience = OLD_AUDIENCES[params.audience ?? ""] ?? params.audience ?? "rrhh";

  const own = await loadOwnHandles();
  const [posts, syntheses] = await Promise.all([
    loadRankedPosts({
      region: region || undefined,
      audience: audience || undefined,
      platform: platform || undefined,
      formats: FORMAT_GROUPS.find((g) => g.key === format)?.formats,
      sortBy: sortBy === "debate" ? "debate" : "outlier",
      onlyRelevant: true,
      // Solo cuentas con línea base conocida: sin eso no se puede decir que un
      // post haya funcionado, solo que tuvo volumen.
      onlyMeasured: true,
      limit: 48,
      // Lo nuestro no es inspiración: va en "Insights propios".
      excludeHandles: own,
    }),
    loadSyntheses(),
  ]);

  const visible = posts;
  const accounts = new Set(visible.map((p) => `${p.platform}:${p.author_handle}`)).size;
  const countryName = REGION_NAMES[region];
  // Argentina y México no tienen síntesis propia: sus posts se explican contra
  // la de hispam, que es la que los midió.
  const whyRegion = countryName ? "hispam" : region || undefined;

  const link = (next: Partial<Params>) => {
    const merged = { region, audience, platform, format, sortBy, ...next };
    const qs = new URLSearchParams(
      Object.entries(merged).filter(([, v]) => v) as Array<[string, string]>,
    ).toString();
    return `/discovery${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Inspiración"
        subtitle={
          sortBy === "debate"
            ? "Posts que se comentaron mucho más de lo habitual en su cuenta. Marcan temas sobre los que el rubro no está de acuerdo: material para escribir."
            : "Posts de otros que más superaron el engagement habitual de su propia cuenta. Se compara cada post contra los de la misma cuenta, no contra el resto: por eso una cuenta chica y una grande se pueden mirar juntas."
        }
      />

      <div className="mb-6 space-y-2 rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <FilterGroup label="Mercado" options={REGIONS} current={region} build={(v) => link({ region: v })} />
        <FilterGroup label="Audiencia" options={AUDIENCES} current={audience} build={(v) => link({ audience: v })} />
        <FilterGroup label="Red" options={PLATFORMS} current={platform} build={(v) => link({ platform: v })} />
        <FilterGroup label="Formato" options={FORMATS} current={format} build={(v) => link({ format: v })} />
        <FilterGroup label="Ordenar" options={ORDERS} current={sortBy} build={(v) => link({ sortBy: v })} />
      </div>

      {countryName && accounts < 3 ? (
        // Pocas cuentas no es "lo que funciona en el país": es lo que funciona
        // en esas cuentas. Se dice antes de que lo lea como tendencia.
        <div className="mb-4 rounded-[var(--r-m)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[14px] font-semibold leading-[1.4]">Todavía seguimos pocas cuentas de {countryName}</p>
          <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
            {accounts === 0
              ? "Ninguna con métricas para este corte."
              : `Estos posts son de ${accounts === 1 ? "una sola cuenta" : `${accounts} cuentas`}: muestran qué le funciona a ${accounts === 1 ? "esa cuenta" : "esas cuentas"}, no al mercado.`}{" "}
            Se completa cuando sumemos referentes de {countryName}.
          </p>
        </div>
      ) : null}

      {!visible.length ? (
        <EmptyState title="No hay posts para este corte" hint="Probá sacar algún filtro." />
      ) : (
        <>
          <p className="mb-3 text-[12px] leading-[1.4] text-[var(--faint)]">{visible.length} posts</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((post) => (
              <PostCard key={post.id} post={post} why={whyItWorked(post, syntheses, whyRegion)} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
