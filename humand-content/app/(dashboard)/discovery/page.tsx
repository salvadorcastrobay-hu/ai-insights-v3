import { EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { PostCard } from "@/components/PostCard";
import { loadRankedPosts } from "@/lib/content/queries";

export const dynamic = "force-dynamic";

const REGIONS = [
  { value: "", label: "Todos" },
  { value: "br", label: "Brasil" },
  { value: "es", label: "España" },
  { value: "hispam", label: "HISPAM" },
];

const AUDIENCES = [
  { value: "hr_leader", label: "RRHH" },
  { value: "candidate", label: "Candidatos" },
  { value: "", label: "Todas" },
];

const PLATFORMS = [
  { value: "", label: "Todas" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
];

const ORDENES = [
  { value: "", label: "Alcance" },
  { value: "debate", label: "Discusión" },
];

type Params = { region?: string; audience?: string; platform?: string; sortBy?: string };

function FilterGroup({
  label,
  options,
  current,
  build,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  current: string;
  build: (value: string) => string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-[12px] uppercase leading-[1.4] text-[var(--faint)]">{label}</span>
      {options.map((option) => (
        <a
          key={option.value}
          href={build(option.value)}
          // El rótulo del grupo se ve pero no está asociado: sin esto hay dos
          // links "Todas" que en el árbol son indistinguibles.
          aria-label={`${label}: ${option.label}`}
          aria-current={current === option.value ? "true" : undefined}
          className={`rounded-full border px-3 py-1 text-[12px] leading-[1.4] transition-colors ${
            current === option.value
              ? "border-transparent bg-[var(--brand-soft-2)] font-semibold text-[var(--brand-deep)]"
              : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]"
          }`}
        >
          {option.label}
        </a>
      ))}
    </div>
  );
}

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const region = params.region ?? "";
  const platform = params.platform ?? "";
  const sortBy = params.sortBy === "debate" ? "debate" : "";
  // Por defecto se muestra la audiencia de RRHH: un post que explota entre
  // candidatos enseña formato, pero su tema no sirve para el calendario.
  const audience = params.audience ?? "hr_leader";

  const posts = await loadRankedPosts({
    region: region || undefined,
    audience: audience || undefined,
    platform: platform || undefined,
    sortBy: sortBy === "debate" ? "debate" : undefined,
    onlyRelevant: true,
    // Solo posts de cuentas con línea base conocida: sin eso no se puede decir
    // que un post haya funcionado, solo que tuvo volumen.
    onlyMeasured: true,
    limit: 40,
  });

  const link = (next: Partial<Params>) => {
    const merged = { region, audience, platform, sortBy, ...next };
    const qs = new URLSearchParams(
      Object.entries(merged).filter(([, v]) => v) as Array<[string, string]>,
    ).toString();
    return `/discovery${qs ? `?${qs}` : ""}`;
  };

  const podium = posts.slice(0, 3);
  const rest = posts.slice(3);

  return (
    <>
      <PageHeader
        title="Qué funciona"
        subtitle={
          sortBy === "debate"
            ? "Posts que se discutieron mucho más de lo normal para su autor. La discusión marca un tema sobre el que el mercado no se puso de acuerdo — y eso es material para escribir, aunque el post no haya tenido alcance."
            : "Posts de referentes del rubro ordenados por cuánto superaron el promedio de su propio autor. Solo entran cuentas con historial suficiente para medirlo."
        }
      />

      {/* En mobile los filtros scrollean en horizontal: envueltos se comían tres
          líneas de alto antes de llegar al primer post. */}
      <div className="-mx-4 mb-6 flex gap-5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterGroup
          label="Mercado"
          options={REGIONS}
          current={region}
          build={(value) => link({ region: value })}
        />
        <FilterGroup
          label="Audiencia"
          options={AUDIENCES}
          current={audience}
          build={(value) => link({ audience: value })}
        />
        <FilterGroup
          label="Red"
          options={PLATFORMS}
          current={platform}
          build={(value) => link({ platform: value })}
        />
        <FilterGroup
          label="Ordenar por"
          options={ORDENES}
          current={sortBy}
          build={(value) => link({ sortBy: value })}
        />
      </div>

      {!posts.length ? (
        <EmptyState
          title="No hay posts para este corte"
          hint="Probá sacar filtros, o corré una actualización desde Sistema."
        />
      ) : (
        <>
          {/* El podio le da forma visible al pedido original: "los 5 que más
              engagement tuvieron". Sin esto el #1 y el #37 se ven idénticos. */}
          <section className="mb-8">
            <SectionLabel>
              {sortBy === "debate"
                ? "Los que más se discutieron"
                : "Los que más superaron su propio promedio"}
            </SectionLabel>
            {/*
              El multiplicador es el número que decide todo el orden y no se
              explicaba en ningún lado. Sin saber contra qué se compara, "46×"
              puede leerse como "46 veces mejor que el resto del mercado", que
              no es lo que dice.
            */}
            <p className="-mt-1 mb-3 text-[12px] leading-[1.4] text-[var(--faint)]">
              {sortBy === "debate"
                ? "El multiplicador compara la proporción de comentarios de este post contra la habitual de esa misma cuenta. Un 4× no es que tuvo cuatro veces más comentarios: es que discutieron cuatro veces más de lo que esa cuenta suele generar."
                : "El multiplicador compara este post contra la mediana de los últimos posts de esa misma cuenta, no contra el resto del mercado. Por eso una cuenta de 700 seguidores y una de 700.000 se pueden mirar juntas. Se cuentan likes y comentarios, y el comentario pesa más."}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {podium.map((post, index) => (
                <PostCard key={post.id} post={post} rank={index + 1} hero />
              ))}
            </div>
          </section>

          {rest.length ? (
            <section>
              <SectionLabel>El resto del corte · {rest.length} posts</SectionLabel>
              <div className="grid gap-4 xl:grid-cols-2">
                {rest.map((post, index) => (
                  <PostCard key={post.id} post={post} rank={index + 4} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
