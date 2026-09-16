import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import type { ReactNode } from "react";

import "@/app/globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Humand Content",
  description: "Qué contenido funciona en el rubro, y por qué",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className={roboto.className}>{children}</body>
    </html>
  );
}
