import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import type { ReactNode } from "react";

import "@/app/globals.css";

// El design system de Humand define dos pesos, 400 y 600. Se cargaban cuatro:
// 500 y 700 no existen en el sistema y eran dos archivos de fuente de más.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "600"],
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
