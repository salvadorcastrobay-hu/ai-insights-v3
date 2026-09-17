import { Badge, Card, EmptyState, PageHeader, SectionLabel, Stat } from "@/components/ui";
import {
  loadApprovalMetrics,
  loadCoverage,
  loadLatestJob,
  loadSources,
} from "@/lib/content/queries";
import { regionLabel, type ContentSource } from "@/lib/content/types";

import { ApprovalButtons, RunButtons } from "./SourceActions";

export const dynamic = "force-dynamic";

/**
 * Operación del pipeline: fuentes, estado del último job y métricas.
 *
 * Antes eran dos pantallas en la nav principal, compitiendo de igual a igual
 * con el trabajo diario de Content. No son para Sofía: son para quien mantiene
 * el sistema. Salvo una cosa —aprobar las cuentas sugeridas—, que sí es
 * curaduría de Content y por eso queda arriba de todo.
 */

const TABS = [
  { value: "fuentes", label: "Fuentes" },
  { value: "metricas", label: "Métricas" },
];

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function JobStatus({ job }: { job: Awaited<ReturnType<typeof loadLatestJob>> }) {
  if (!job) return null;
  const running = job.state === "queued" || job.state === "running";
  const { done, total, upserted } = job.progress ?? {};

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center gap-3 text-[14px] leading-[1.4]">
        <Badge tone={running ? "brand" : job.state === "failed" ? "warn" : "muted"}>
          {job.state}
        </Badge>
        <span className="text-[var(--muted)]">
          {job.kind}
          {typeof done === "number" && typeof total === "number"
            ? ` · ${done}/${total} fuentes`
            : ""}
          {typeof upserted === "number" ? ` · ${upserted} posts` : ""}
        </span>
        {job.current_label ? <span className="text-[var(--muted)]">{job.current_label}</span> : null}
        {running ? (
          <span className="ml-auto text-[12px] text-[var(--faint)]">
            Refrescá la página para ver el avance.
          </span>
        ) : null}
      </div>
      {job.error ? (
        <p className="mt-2 text-[14px] leading-[1.4] text-[var(--error)]">{job.error}</p>
      ) : null}
    </Card>
  );
}

function SourceRow({ source }: { source: ContentSource }) {
  const suggested = source.approval_state === "suggested";
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] py-2 text-[14px] leading-[1.4] last:border-0">
      <span className="font-semibold">{source.label ?? source.value}</span>
      <span className="text-[12px] text-[var(--faint)]">{source.value}</span>
      {/* Antes iban cuatro badges del mismo peso. La red y el tipo alcanzan. */}
      <Badge tone="muted">{source.platform}</Badge>
      <Badge tone="muted">{source.kind}</Badge>
      <span className="ml-auto flex items-center gap-2">
        {source.last_run_status && !suggested ? (
          <span className="text-[12px] text-[var(--faint)]">{source.last_run_status}</span>
        ) : null}
        {suggested ? <ApprovalButtons id={source.id} /> : null}
      </span>
    </li>
  );
}

function SourcesTab({
  sources,
  job,
}: {
  sources: ContentSource[];
  job: Awaited<ReturnType<typeof loadLatestJob>>;
}) {
  const suggested = sources.filter((s) => s.approval_state === "suggested");
  const approved = sources.filter((s) => s.approval_state === "approved");

  // Agrupadas por mercado: cien fuentes en una sola lista son un muro.
  const byRegion = new Map<string, ContentSource[]>();
  for (const source of approved) {
    const list = byRegion.get(source.region) ?? [];
    list.push(source);
    byRegion.set(source.region, list);
  }

  return (
    <>
      <JobStatus job={job} />

      <section className="mb-8">
        <SectionLabel>Por revisar · {suggested.length}</SectionLabel>
        <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
          Cuentas que aparecieron en las búsquedas. Aprobar una significa traer sus posts en cada
          corrida, así que conviene mirarlas antes.
        </p>
        {suggested.length ? (
          <Card>
            <ul>
              {suggested.slice(0, 40).map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ul>
            {suggested.length > 40 ? (
              <p className="mt-2 text-[12px] text-[var(--faint)]">
                Se muestran 40 de {suggested.length}.
              </p>
            ) : null}
          </Card>
        ) : (
          <EmptyState title="No hay fuentes pendientes de revisión" />
        )}
      </section>

      <section>
        <SectionLabel>Activas · {approved.length}</SectionLabel>
        <div className="space-y-4">
          {[...byRegion.entries()].map(([region, list]) => (
            <Card key={region}>
              <p className="mb-1 text-[14px] font-semibold leading-[1.4]">
                {regionLabel(region)}{" "}
                <span className="font-normal text-[var(--faint)]">({list.length})</span>
              </p>
              <ul>
                {list.map((s) => (
                  <SourceRow key={s.id} source={s} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

function MetricsTab({
  approval,
  coverage,
}: {
  approval: Awaited<ReturnType<typeof loadApprovalMetrics>> | null;
  coverage: Awaited<ReturnType<typeof loadCoverage>>;
}) {
  return (
    <>
      <section className="mb-8">
        <SectionLabel>Calidad de las sugerencias</SectionLabel>
        <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
          Qué proporción de lo que proponemos se aprueba sin tocar. Es la métrica principal: mide si
          el research llega hasta la pieza.
        </p>

        {!approval || approval.total_decided + approval.pending === 0 ? (
          <EmptyState
            title="Todavía no hay piezas decididas"
            hint="Aparecen acá a medida que el equipo aprueba o descarta desde el calendario."
          />
        ) : (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Aprobadas sin cambios"
                value={pct(approval.approved_as_is_rate)}
                hint={`${approval.approved_as_is} de ${approval.total_decided} decididas`}
              />
              <Stat label="Con cambios" value={approval.approved_edited} />
              <Stat label="Descartadas" value={approval.rejected} />
              <Stat
                label="Sin revisar"
                value={approval.pending}
                hint={approval.pending ? "Esperando decisión" : undefined}
              />
            </div>
            {approval.total_decided > 0 && approval.total_decided < 10 ? (
              <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
                Con {approval.total_decided} decisiones el porcentaje todavía se mueve mucho.
                Tomalo como indicio, no como medición.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mb-8">
        <SectionLabel>Cobertura semanal</SectionLabel>
        <p className="mb-3 text-[14px] leading-[1.4] text-[var(--muted)]">
          Si el research fue completo o parcial. Lo que importa acá no es solo cuánto se trajo, sino
          qué falló.
        </p>

        {!coverage.length ? (
          <EmptyState
            title="Sin fotos de cobertura"
            hint="Se toma una por semana, al final del ciclo de análisis."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] leading-[1.4]">
                <thead>
                  <tr className="text-left text-[12px] uppercase text-[var(--faint)]">
                    <th className="pb-2 pr-4 font-normal">Semana</th>
                    <th className="pb-2 pr-4 font-normal">Redes</th>
                    <th className="pb-2 pr-4 text-right font-normal">Fuentes OK</th>
                    <th className="pb-2 pr-4 text-right font-normal">Fallaron</th>
                    <th className="pb-2 pr-4 text-right font-normal">Competidores</th>
                    <th className="pb-2 pr-4 text-right font-normal">Posts</th>
                    <th className="pb-2 text-right font-normal">Analizados</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((week) => (
                    <tr key={week.week} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-4 font-semibold">{week.week}</td>
                      <td className="py-2 pr-4">{week.platforms_covered.join(", ") || "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {week.sources_ok}/{week.sources_total}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right tabular-nums ${
                          week.sources_failed ? "text-[var(--error)]" : ""
                        }`}
                      >
                        {week.sources_failed}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {week.competitors_covered}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{week.posts_ingested}</td>
                      <td className="py-2 text-right tabular-nums">{week.posts_analyzed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* Colapsado: es honestidad sobre lo que falta, no algo que haya que leer
          cada vez que se entra. */}
      <details>
        <summary className="cursor-pointer list-none text-[12px] font-semibold uppercase leading-[1.4] text-[var(--muted)] hover:text-[var(--text)]">
          Todavía sin medir ▾
        </summary>
        <Card className="mt-2">
          <ul className="space-y-1 text-[14px] leading-[1.4] text-[var(--muted)]">
            <li>
              <span className="font-semibold text-[var(--text)]">
                Performance de lo publicado vs. nuestro baseline
              </span>{" "}
              — el registro ya guarda el link de la pieza publicada; falta cruzarlo con el post real
              una vez que tenga métricas maduras.
            </li>
            <li>
              <span className="font-semibold text-[var(--text)]">
                Tiempo dedicado a research manual
              </span>{" "}
              — no es observable desde el sistema. Requiere que el equipo lo reporte.
            </li>
            <li>
              <span className="font-semibold text-[var(--text)]">Uso del chatbot</span> — no existe
              todavía.
            </li>
          </ul>
        </Card>
      </details>
    </>
  );
}

export default async function SistemaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = (await searchParams).tab === "metricas" ? "metricas" : "fuentes";

  const [sources, job, approval, coverage] = await Promise.all([
    loadSources(),
    loadLatestJob().catch(() => null),
    loadApprovalMetrics().catch(() => null),
    loadCoverage().catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        title="Sistema"
        subtitle="Qué mira el pipeline, cómo salió la última corrida y si las sugerencias sirven."
        actions={<RunButtons />}
      />

      <div className="mb-6 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <a
            key={t.value}
            href={`/sistema?tab=${t.value}`}
            className={`-mb-px border-b-2 px-3 pb-2 text-[14px] transition-colors ${
              tab === t.value
                ? "border-[var(--brand)] font-semibold text-[var(--text)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {tab === "fuentes" ? (
        <SourcesTab sources={sources} job={job} />
      ) : (
        <MetricsTab approval={approval} coverage={coverage} />
      )}
    </>
  );
}
