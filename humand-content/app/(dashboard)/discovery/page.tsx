import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { loadRankedPosts } from "@/lib/content/queries";
import {
  TARGET_PROFILE_LABELS,
  type ContentPost,
  type TargetProfile,
} from "@/lib/content/types";

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

function engagement(post: ContentPost): number {
  return (post.likes_count ?? 0) + (post.comments_count ?? 0) + (post.shares_count ?? 0);
}

function Filters({ region, audience }: { region: string; audience: string }) {
  const link = (next: Record<string, string>) => {
    const params = new URLSearchParams({ region, audience, ...next });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    const qs = params.toString();
    return `/discovery${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Mercado</span>
        {REGIONS.map((r) => (
          <a
            key={r.value}
            href={link({ region: r.value })}
            className={`rounded-full border px-3 py-1 text-xs ${
              region === r.value
                ? "border-[#d4defa] bg-[var(--brand-soft)] text-[#2f4fa3]"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {r.label}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Audiencia</span>
        {AUDIENCES.map((a) => (
          <a
            key={a.value}
            href={link({ audience: a.value })}
            className={`rounded-full border px-3 py-1 text-xs ${
              audience === a.value
                ? "border-[#d4defa] bg-[var(--brand-soft)] text-[#2f4fa3]"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {a.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; audience?: string }>;
}) {
  const params = await searchParams;
  const region = params.region ?? "";
  // Por defecto se muestra la audiencia de RRHH: un post que explota entre
  // candidatos enseña formato, pero su tema no sirve para el calendario.
  const audience = params.audience ?? "hr_leader";

  const posts = await loadRankedPosts({
    region: region || undefined,
    audience: audience || undefined,
    onlyRelevant: true,
    // Solo posts de cuentas con línea base conocida: sin eso no se puede decir
    // que un post haya funcionado, solo que tuvo volumen.
    onlyMeasured: true,
    limit: 40,
  });

  return (
    <>
      <PageHeader
        title="Qué funciona"
        subtitle="Posts de referentes del rubro, ordenados por cuánto superaron el promedio de su propio autor. Solo se listan cuentas con historial suficiente para medirlo."
      />
      <Filters region={region} audience={audience} />

      {!posts.length ? (
        <EmptyState
          title="No hay posts para este corte"
          hint="Probá sacar filtros, o corré una actualización desde Fuentes."
        />
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                  <span className="font-medium text-[var(--text)]">@{post.author_handle}</span>
                  <Badge tone="muted">{post.platform}</Badge>
                  {post.analysis?.hook_pattern ? (
                    <Badge tone="brand">{post.analysis.hook_pattern}</Badge>
                  ) : null}
                  {post.analysis?.theme ? <Badge>{post.analysis.theme}</Badge> : null}
                  {post.outlier_factor ? (
                    <span className="ml-auto font-medium text-[var(--text)]">
                      {post.outlier_factor.toFixed(1)}× su promedio
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-sm font-medium">
                  {post.analysis?.hook ?? post.caption?.slice(0, 120) ?? "(sin texto)"}
                </p>

                {post.analysis?.development ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">{post.analysis.development}</p>
                ) : null}

                {post.analysis?.why_it_worked ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <span className="font-medium">Por qué funcionó:</span>{" "}
                    {post.analysis.why_it_worked}
                  </p>
                ) : null}

                {post.analysis?.cta ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <span className="font-medium">CTA:</span> {post.analysis.cta}
                  </p>
                ) : null}

                {post.analysis?.target_profiles?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-[var(--muted)]">Le interesa a:</span>
                    {post.analysis.target_profiles.map((profile: TargetProfile) => (
                      <Badge key={profile} tone="muted">
                        {TARGET_PROFILE_LABELS[profile] ?? profile}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {post.analysis?.humand_angle ? (
                  <p className="mt-2 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm">
                    <span className="font-medium">Para Humand:</span> {post.analysis.humand_angle}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                  <span>{engagement(post).toLocaleString("es")} interacciones</span>
                  {post.analysis?.replicability ? (
                    <span>replicabilidad {post.analysis.replicability}</span>
                  ) : null}
                  {post.analysis?.structure ? <span>{post.analysis.structure}</span> : null}
                  {post.analysis?.hashtag_strategy ? (
                    <span>hashtags: {post.analysis.hashtag_strategy.replace(/_/g, " ")}</span>
                  ) : null}
                  {post.analysis?.copy_length ? (
                    <span>{post.analysis.copy_length} caracteres</span>
                  ) : null}
                  {post.post_url ? (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--brand)] underline"
                    >
                      ver el post
                    </a>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
