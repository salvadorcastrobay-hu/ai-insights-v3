import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import type { ReactNode } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import "@/app/globals.css";
import { AuthProvider } from "@/lib/auth/auth-provider";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Humand Insights",
  description: "Humand insights dashboard migrated to Next.js",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={roboto.className}>
        <AuthProvider>
          <NuqsAdapter>{children}</NuqsAdapter>
        </AuthProvider>
      </body>
    </html>
  );
}
