"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const isSubmitting = status.kind === "submitting";
  const isSuccess = status.kind === "success";

  // Fire-and-forget cache warmup so the 95s insights scan runs in parallel
  // with the user typing credentials.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/prefetch-insights", { signal: controller.signal, cache: "no-store" }).catch(() => {
      // best-effort
    });
    return () => controller.abort();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });

    try {
      const supabase = createClient();
      const fullEmail = email.includes("@") ? email.trim() : `${email.trim()}@humand.co`;
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: fullEmail,
        password,
      });
      if (authError) {
        // Mensaje más claro para los errores comunes de Supabase.
        const msg =
          authError.message?.toLowerCase().includes("invalid login")
            ? "Usuario o contraseña incorrectos."
            : authError.message || "No pudimos iniciar sesión. Probá de nuevo.";
        setStatus({ kind: "error", message: msg });
        return;
      }
      setStatus({ kind: "success" });
      // Pequeño delay para que el usuario vea el checkmark antes del redirect.
      setTimeout(() => {
        router.push("/overview");
        router.refresh();
      }, 350);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setStatus({ kind: "error", message: msg });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md space-y-4">
        <header>
          <h1 className="text-[24px]">Login</h1>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Use your Humand account credentials.
          </p>
        </header>

        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">
            Usuario o email
            <Input
              type="text"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting || isSuccess}
              required
            />
          </label>

          <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">
            Password
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting || isSuccess}
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isSubmitting || isSuccess}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-default)] disabled:opacity-50"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {status.kind === "error" ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-s)] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{status.message}</span>
            </div>
          ) : null}

          {status.kind === "success" ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-[var(--radius-s)] border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-700"
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>Sesión iniciada. Redirigiendo…</span>
            </div>
          ) : null}

          <Button type="submit" disabled={isSubmitting || isSuccess} className="w-full">
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Signing in…
              </span>
            ) : isSuccess ? (
              "Listo"
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Card>
    </main>
  );
}
