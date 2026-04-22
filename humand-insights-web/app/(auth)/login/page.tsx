"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fire-and-forget cache warmup so the 95s insights scan runs in parallel
  // with the user typing credentials. We don't await — the response may not
  // come back before they submit, but the unstable_cache entry will exist
  // by the time the dashboard loads.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/prefetch-insights", { signal: controller.signal, cache: "no-store" }).catch(() => {
      // Swallow: this is a best-effort warmup.
    });
    return () => controller.abort();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.push("/executive-summary");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md space-y-4">
        <header>
          <h1 className="text-[24px]">Login</h1>
          <p className="text-[14px] text-[var(--color-text-secondary)]">Use your Humand account credentials.</p>
        </header>
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">
            Email
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">
            Password
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
