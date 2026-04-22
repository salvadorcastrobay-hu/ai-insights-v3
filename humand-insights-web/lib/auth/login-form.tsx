"use client";

import { useMemo, useState } from "react";
import { AlertCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseBrowserClient } from "@/lib/auth/auth-provider";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = useMemo(() => searchParams.get("next") ?? "/executive-summary", [searchParams]);
  const supabase = useSupabaseBrowserClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsPending(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md overflow-hidden border border-white/70 bg-white/95 backdrop-blur-sm">
      <CardHeader className="gap-3 pb-4">
        <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--color-blueprimary-100)] text-[var(--color-brand-500)]">
          <LockKeyhole className="size-5" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-[24px]">Sign in to Humand Insights</CardTitle>
          <CardDescription>
            Supabase Auth powers the new frontend shell while the Python pipeline stays intact.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input
                id="email"
                autoComplete="email"
                className="pl-9"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@humand.co"
                value={email}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input
                id="password"
                autoComplete="current-password"
                className="pl-9"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                type="password"
                value={password}
              />
            </div>
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-m)] border border-[#f2b8b8] bg-[#fff3f3] px-3 py-2 text-[13px] text-[#a63a3a]">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          <Button className="w-full" disabled={isPending} type="submit">
            {isPending ? "Signing in..." : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
