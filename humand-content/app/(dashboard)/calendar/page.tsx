import { Badge, Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import { loadCalendars, loadFeedback, suggestionKey } from "@/lib/content/queries";
import { regionLabel, type CalendarEntry, type ContentCalendar } from "@/lib/content/types";

import { FeedbackButtons } from "./FeedbackButtons";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * Grilla del mes.
 *
 * Antes era una lista vertical con la fecha como texto chico. Una lista no
 * muestra lo único que hace falta ver cuando armás un mes: dónde están los
 * huecos. Con trece piezas sobre veintidós días hábiles, el hueco es el dato.
 */
function MonthGrid({ month, entries }: { month: string; entries: CalendarEntry[] }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // getUTCDay() devuelve 0 para domingo; la semana acá arranca el lunes.
  const leading = (first.getUTCDay() + 6) % 7;

  const byDay = new Map<number, CalendarEntry>();
  for (const entry of entries) byDay.set(Number(entry.date.slice(8, 10)), entry);

  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((day, index) => (
        <div
          key={`${day}-${index}`}
          className="pb-1 text-center text-[10px] font-semibold uppercase leading-[1.4] text-[var(--faint)]"
        >
          {day}
        </div>
      ))}
      {cells.map((day, index) => {
        if (day === null) return <div key={`empty-${index}`} />;
        const entry = byDay.get(day);
        const weekend = (index % 7) >= 5;
        return (
          <a
            key={day}
            href={entry ? `#pieza-${entry.date}` : undefined}
            title={entry ? `${entry.date} · ${entry.title}` : undefined}
            // Alto fijo: con el título completo adentro cada celda medía
            // distinto y la grilla del mes dejaba de leerse como una grilla.
            className={`flex h-[52px] flex-col overflow-hidden rounded-[var(--r-s)] border p-1 text-left transition-colors ${
              entry
                ? "border-transparent bg-[var(--brand-soft-2)] hover:bg-[var(--brand-soft)]"
                : weekend
                  ? "border-transparent bg-transparent"
                  : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <span
              className={`block text-[10px] leading-[1.4] tabular-nums ${
                entry ? "font-semibold text-[var(--brand-deep)]" : "text-[var(--faint)]"
              }`}
            >
              {day}
            </span>
            {entry ? (
              <span className="mt-0.5 line-clamp-2 block text-[9px] leading-[1.25] text-[var(--brand-deep)]">
                {entry.title}
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

function EntryCard({
  cal,
  entry,
  state,
}: {
  cal: ContentCalendar;
  entry: CalendarEntry;
  state: string;
}) {
  const day = new Date(`${entry.date}T12:00:00Z`);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold leading-[1.4] tabular-nums">
          {day.toLocaleDateString("es", { day: "numeric", month: "short", timeZone: "UTC" })}
        </span>
        <Badge tone="brand">{entry.hook_pattern.replace(/_/g, " ")}</Badge>
        <Badge tone="muted">{entry.theme.replace(/_/g, " ")}</Badge>
        <Badge tone="muted">{entry.format}</Badge>
      </div>

      <h3 className="mt-2 text-[18px] font-semibold leading-[1.4]">{entry.title}</h3>
      <p className="mt-1 text-[14px] leading-[1.4]">{entry.hook}</p>
      <p className="mt-1 text-[14px] leading-[1.4] text-[var(--muted)]">{entry.angle}</p>

      {entry.cta ? (
        <p className="mt-1 text-[14px] leading-[1.4] text-[var(--muted)]">
          <span className="font-semibold">CTA · </span>
          {entry.cta}
        </p>
      ) : null}

      {/* La cita de la evidencia es lo que separa esto de una lluvia de ideas. */}
      <p className="mt-3 border-l-2 border-[var(--brand-soft-2)] pl-3 text-[12px] leading-[1.4] text-[var(--muted)]">
        <span className="font-semibold">Se apoya en · </span>
        {entry.based_on}
      </p>

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <FeedbackButtons
          entryKey={suggestionKey(cal.region, cal.month, entry.date, entry.title)}
          current={state as never}
        />
      </div>
    </Card>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
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

  const requested = (await searchParams).region;
  // Un mercado por vez. Apilados no se comparaban: se leían tres veces seguidas.
  const cal = calendars.find((c) => c.region === requested) ?? calendars[0];

  const pending = cal.entries.filter(
    (e) =>
      (feedback.get(suggestionKey(cal.region, cal.month, e.date, e.title))?.state ?? "pending") ===
      "pending",
  ).length;

  return (
    <>
      <PageHeader
        title="Calendario"
        subtitle="Borrador armado con lo que funcionó. El patrón de cada pieza sale del lift medido en ese mercado, no de una corazonada."
      />

      <div className="mb-6 flex flex-wrap items-center gap-1 border-b border-[var(--border)]">
        {calendars.map((c) => (
          <a
            key={c.region}
            href={`/calendar?region=${c.region}`}
            className={`-mb-px border-b-2 px-3 pb-2 text-[14px] transition-colors ${
              c.region === cal.region
                ? "border-[var(--brand)] font-semibold text-[var(--text)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {regionLabel(c.region)}
          </a>
        ))}
        <span className="ml-auto pb-2 text-[12px] text-[var(--faint)]">
          {cal.month} · {cal.entries.length} piezas
          {pending ? ` · ${pending} sin revisar` : " · todas revisadas"}
        </span>
      </div>

      {cal.warnings.map((warning) => (
        <div key={warning} className="mb-3">
          <Callout>{warning}</Callout>
        </div>
      ))}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <SectionLabel>{cal.month}</SectionLabel>
            <MonthGrid month={cal.month} entries={cal.entries} />
            <p className="mt-3 text-[12px] leading-[1.4] text-[var(--faint)]">
              Sobre {cal.evidence.posts_considered} posts analizados.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {cal.evidence.winning_hooks
                .filter((h) => h.lift > 1)
                .map((h) => (
                  <Badge key={h.key} tone="brand">
                    {h.key.replace(/_/g, " ")} {h.lift}×
                  </Badge>
                ))}
            </div>
          </Card>
        </div>

        <div className="space-y-3">
          {cal.entries.map((entry) => (
            <div key={`${entry.date}-${entry.title}`} id={`pieza-${entry.date}`} className="scroll-mt-20">
              <EntryCard
                cal={cal}
                entry={entry}
                state={
                  feedback.get(suggestionKey(cal.region, cal.month, entry.date, entry.title))
                    ?.state ?? "pending"
                }
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
