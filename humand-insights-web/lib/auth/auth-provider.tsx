"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type AuthContextValue = {
  supabase: SupabaseClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      router.refresh();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  return <AuthContext.Provider value={{ supabase }}>{children}</AuthContext.Provider>;
}

export function useSupabaseBrowserClient(): SupabaseClient {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useSupabaseBrowserClient must be used within AuthProvider.");
  }

  return context.supabase;
}
