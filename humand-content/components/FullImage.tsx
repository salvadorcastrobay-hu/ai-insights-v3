"use client";

import { useState } from "react";

/**
 * La pieza completa, sin recortar.
 *
 * La portada de la tarjeta va a formato fijo para que la grilla no baile, pero
 * eso corta el creativo justo donde suele estar el mensaje — en contenido de
 * RRHH la placa vertical lleva el texto abajo. Acá se muestra entera.
 *
 * Es client component por lo mismo que PostMedia: una URL firmada vencida
 * devuelve 403 y sin capturar `onError` el navegador pinta el ícono roto.
 */
export function FullImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-[var(--r-m)] bg-[var(--surface-sunk)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        // max-h para que una placa muy vertical no empuje media pantalla.
        className="mx-auto max-h-[560px] w-auto max-w-full object-contain"
      />
    </div>
  );
}
