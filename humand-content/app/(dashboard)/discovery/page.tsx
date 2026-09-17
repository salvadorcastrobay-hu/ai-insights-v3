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

type Params = { region?: string; audience?: string; platform?: string };

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
  // Por defecto se muestra la audiencia de RRHH: un post que explota entre
  // candidatos enseña formato, pero su tema no sirve para el calendario.
  const audience = params.audience ?? "hr_leader";

  const posts = await loadRankedPosts({
    region: region || undefined,
    audience: audience || undefined,
    platform: platform || undefined,
    onlyRelevant: true,
    // Solo posts de cuentas con línea base conocida: sin eso no se puede decir
    // que un post haya funcionado, solo que tuvo volumen.
    onlyMeasured: true,
    limit: 40,
  });

  const link = (next: Partial<Params>) => {
    const merged = { region, audience, platform, ...next };
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
        subtitle="Posts de referentes del rubro ordenados por cuánto superaron el promedio de su propio autor. Solo entran cuentas con historial suficiente para medirlo."
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
            <SectionLabel>Los que más superaron su propio promedio</SectionLabel>
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
