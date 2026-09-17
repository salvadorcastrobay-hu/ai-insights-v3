"use client";

import { useState } from "react";

/**
 * Imagen de un post, con degradación a tarjeta tipográfica.
 *
 * Es client component por una sola razón: `onError`. Una URL firmada vencida
 * devuelve 403 y el navegador pinta el ícono de imagen rota — sin capturar ese
 * evento no hay forma de reemplazarla. Es la única interacción del componente.
 *
 * El fallback NO es un placeholder gris. Un tercio de los posts de LinkedIn son
 * de texto plano y nunca tuvieron imagen: en esa red el post de texto es un
 * formato de alto rendimiento, no un caso degradado. Mostrar un ícono de "falta
 * la foto" describiría mal el dato. Se muestra el copy como si fuera el visual,
 * porque es exactamente lo que es.
 */

/** Fondos del fallback. Salen de la escala de azules de Humand. */
const FALLBACK_BG = ["#2c35a1", "#29317f", "#1d204e", "#3851d8"];

function pickBackground(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return FALLBACK_BG[Math.abs(hash) % FALLBACK_BG.length];
}

export function PostMedia({
  src,
  seed,
  text,
  className = "",
}: {
  src: string | null;
  /** Estabiliza el color: el mismo autor siempre cae en el mismo fondo. */
  seed: string;
  text: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      /*
       * <img> y no next/image: el optimizador hace el fetch del lado del
       * server, así que un 403 de la URL firmada nunca llega al onError de acá
       * y la tarjeta no puede degradar.
       */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`absolute inset-0 flex items-end p-3 ${className}`}
      style={{ backgroundColor: pickBackground(seed) }}
    >
      <p className="line-clamp-6 text-[14px] font-semibold leading-[1.4] text-white/90">
        {text.slice(0, 140)}
      </p>
    </div>
  );
}
