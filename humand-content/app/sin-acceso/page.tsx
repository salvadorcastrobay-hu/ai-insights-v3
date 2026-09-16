export default function SinAccesoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">No tenés acceso a esta app</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Humand Content es del equipo de Content. Pedí que te agreguen el rol{" "}
          <code className="rounded bg-[var(--brand-soft)] px-1">content</code> en Supabase.
        </p>
      </div>
    </main>
  );
}
