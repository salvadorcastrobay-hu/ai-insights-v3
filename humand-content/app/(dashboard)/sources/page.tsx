import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { loadLatestJob, loadSources } from "@/lib/content/queries";
import { regionLabel, type ContentSource } from "@/lib/content/types";

import { ApprovalButtons, RunButtons } from "./SourceActions";

export const dynamic = "force-dynamic";

function JobStatus({ job }: { job: Awaited<ReturnType<typeof loadLatestJob>> }) {
  if (!job) return null;
  const running = job.state === "queued" || job.state === "running";
  const { done, total, upserted } = job.progress ?? {};

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
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
        {job.current_label ? (
          <span className="text-[var(--muted)]">{job.current_label}</span>
        ) : null}
        {running ? (
          <span className="ml-auto text-xs text-[var(--muted)]">
            Refrescá la página para ver el avance.
          </span>
        ) : null}
      </div>
      {job.error ? <p className="mt-2 text-sm text-red-600">{job.error}</p> : null}
    </Card>
  );
}

function SourceRow({ source }: { source: ContentSource }) {
  const suggested = source.approval_state === "suggested";
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] py-2 text-sm last:border-0">
      <span className="font-medium">{source.label ?? source.value}</span>
      <span className="text-xs text-[var(--muted)]">{source.value}</span>
      <Badge tone="muted">{source.platform}</Badge>
      <Badge>{source.kind}</Badge>
      <Badge tone="muted">{regionLabel(source.region)}</Badge>
      {source.audience ? <Badge tone="muted">{source.audience}</Badge> : null}
      <span className="ml-auto flex items-center gap-2">
        {source.last_run_status && !suggested ? (
          <span className="text-xs text-[var(--muted)]">{source.last_run_status}</span>
        ) : null}
        {suggested ? <ApprovalButtons id={source.id} /> : null}
      </span>
    </li>
  );
}

export default async function SourcesPage() {
  const [sources, job] = await Promise.all([loadSources(), loadLatestJob().catch(() => null)]);

  const suggested = sources.filter((s) => s.approval_state === "suggested");
  const approved = sources.filter((s) => s.approval_state === "approved");

  return (
    <>
      <PageHeader
        title="Fuentes"
        subtitle="Qué cuentas, hashtags y búsquedas mira el sistema. Agregar una acá no necesita un deploy."
        actions={<RunButtons />}
      />

      <JobStatus job={job} />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">
          Por revisar{" "}
          <span className="font-normal text-[var(--muted)]">({suggested.length})</span>
        </h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
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
              <p className="mt-2 text-xs text-[var(--muted)]">
                Se muestran 40 de {suggested.length}.
              </p>
            ) : null}
          </Card>
        ) : (
          <EmptyState title="No hay fuentes pendientes de revisión" />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Activas <span className="font-normal text-[var(--muted)]">({approved.length})</span>
        </h2>
        <Card>
          <ul>
            {approved.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}
