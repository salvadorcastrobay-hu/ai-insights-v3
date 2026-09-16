import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { loadApprovalMetrics, loadCoverage } from "@/lib/content/queries";

export const dynamic = "force-dynamic";

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export default async function MetricsPage() {
  const [approval, coverage] = await Promise.all([
    loadApprovalMetrics().catch(() => null),
    loadCoverage().catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        title="Métricas"
        subtitle="Las métricas de éxito del brief. Se miden desde que el equipo empieza a decidir sobre las piezas — antes de eso no hay nada que medir."
      />

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">
          Calidad de las sugerencias
        </h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Qué proporción de lo que proponemos se aprueba sin tocar. Es la métrica
          principal: mide si el research llega hasta la pieza.
        </p>

        {!approval || approval.total_decided + approval.pending === 0 ? (
          <EmptyState
            title="Todavía no hay piezas decididas"
            hint="Aparecen acá a medida que el equipo aprueba o descarta desde el calendario."
          />
        ) : (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-4">
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
              <p className="text-sm text-[var(--muted)]">
                Con {approval.total_decided} decisiones el porcentaje todavía se mueve mucho.
                Tomalo como indicio, no como medición.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Cobertura semanal</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Si el research fue completo o parcial. Lo que importa acá no es solo
          cuánto se trajo, sino qué falló.
        </p>

        {!coverage.length ? (
          <EmptyState
            title="Sin fotos de cobertura"
            hint="Se toma una por semana, al final del ciclo de análisis."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
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
                      <td className="py-2 pr-4 font-medium">{week.week}</td>
                      <td className="py-2 pr-4">{week.platforms_covered.join(", ") || "—"}</td>
                      <td className="py-2 pr-4 text-right">
                        {week.sources_ok}/{week.sources_total}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right ${
                          week.sources_failed ? "text-red-600" : ""
                        }`}
                      >
                        {week.sources_failed}
                      </td>
                      <td className="py-2 pr-4 text-right">{week.competitors_covered}</td>
                      <td className="py-2 pr-4 text-right">{week.posts_ingested}</td>
                      <td className="py-2 text-right">{week.posts_analyzed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Todavía sin medir</h2>
        <Card>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            <li>
              <span className="font-medium text-[var(--text)]">
                Performance de lo publicado vs. nuestro baseline
              </span>{" "}
              — el registro ya guarda el link de la pieza publicada; falta cruzarlo
              con el post real una vez que tenga métricas maduras.
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">
                Tiempo dedicado a research manual
              </span>{" "}
              — no es observable desde el sistema. Requiere que el equipo lo reporte.
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">Uso del chatbot</span> — no
              existe todavía.
            </li>
          </ul>
        </Card>
      </section>
    </>
  );
}
