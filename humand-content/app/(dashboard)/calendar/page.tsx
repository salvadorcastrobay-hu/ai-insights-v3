import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { loadCalendars, loadFeedback, suggestionKey } from "@/lib/content/queries";
import { regionLabel } from "@/lib/content/types";

import { FeedbackButtons } from "./FeedbackButtons";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [calendars, feedback] = await Promise.all([
    loadCalendars(),
    // Si el feedback falla, el calendario se muestra igual: no poder registrar
    // una decisión no puede impedir ver las piezas.
    loadFeedback().catch(() => new Map()),
  ]);

  if (!calendars.length) {
    return (
      <>
        <PageHeader title="Calendario" />
        <EmptyState title="Todavía no hay calendarios generados" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Calendario"
        subtitle="Borrador armado con lo que funcionó. El patrón de cada pieza sale del lift medido en ese mercado, no de una corazonada."
      />

      <div className="space-y-8">
        {calendars.map((cal) => (
          <section key={`${cal.region}:${cal.month}`}>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-base font-semibold">{regionLabel(cal.region)}</h2>
              <span className="text-sm text-[var(--muted)]">{cal.month}</span>
              <span className="text-xs text-[var(--muted)]">
                sobre {cal.evidence.posts_considered} posts analizados
              </span>
              <div className="ml-auto flex gap-1">
                {cal.evidence.winning_hooks
                  .filter((h) => h.lift > 1)
                  .map((h) => (
                    <Badge key={h.key} tone="brand">
                      {h.key} {h.lift}×
                    </Badge>
                  ))}
              </div>
            </div>

            {cal.warnings.map((warning) => (
              <p
                key={warning}
                className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {warning}
              </p>
            ))}

            <ul className="space-y-2">
              {cal.entries.map((entry) => (
                <li key={`${cal.region}-${entry.date}-${entry.title}`}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="font-medium text-[var(--text)]">{entry.date}</span>
                      <Badge tone="brand">{entry.hook_pattern}</Badge>
                      <Badge>{entry.theme}</Badge>
                      <Badge tone="muted">{entry.format}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium">{entry.hook}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{entry.angle}</p>
                    {entry.cta ? (
                      <p className="mt-1 text-sm text-[var(--muted)]">CTA: {entry.cta}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      <span className="font-medium">Se apoya en:</span> {entry.based_on}
                    </p>
                    <div className="mt-3 border-t border-[var(--border)] pt-2">
                      <FeedbackButtons
                        entryKey={suggestionKey(cal.region, cal.month, entry.date, entry.title)}
                        current={
                          feedback.get(
                            suggestionKey(cal.region, cal.month, entry.date, entry.title),
                          )?.state ?? "pending"
                        }
                      />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
