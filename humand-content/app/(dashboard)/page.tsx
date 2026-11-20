import Link from "next/link";

import { PostCard } from "@/components/PostCard";
import { APP_NAME } from "@/lib/content/brand";
import { loadHighlights } from "@/lib/content/highlights";
import { whyItWorked } from "@/lib/content/why";

export const dynamic = "force-dynamic";

/**
 * Inicio.
 *
 * "Simplificar el inicio" fue lo primero del feedback: entrar y entender qué
 * se puede hacer, en vez de caer en una grilla de cuarenta posts. Cinco
 * puertas —las mismas del menú— y una muestra corta de lo que más rindió para
 * que la página no sea un índice vacío.
 */

const DOORS: Array<{ href: string; title: string; body: string; soon?: boolean }> = [
  {
    href: "/discovery",
    title: "Inspiración",
    body: "Los posts de otros que más superaron el engagement habitual de su cuenta, y qué podés tomar de cada uno.",
  },
  {
    href: "/insights",
    title: "Insights claves",
    body: "Qué está funcionando en las redes del rubro, por mercado: formatos, aperturas y temas.",
  },
  {
    href: "/propios",
    title: "Insights propios",
    body: "Nuestros posts con sus métricas: qué funcionó, qué no y por qué.",
  },
  {
    href: "/ads",
    title: "Ads propios",
    body: "Nuestros anuncios de Meta: cuánto invertimos, cuántos leads trajeron y qué piezas salieron más baratas.",
  },
  {
    href: "/chat",
    title: `Preguntarle a ${APP_NAME}`,
    body: "Contale qué tenés que publicar y te sugiere cómo, con los datos de la herramienta.",
  },
];

export default async function Home() {
  const { posts, syntheses } = await loadHighlights();

  return (
    <>
      <h1 className="text-[32px] font-semibold leading-[1.3]">¿Qué venís a hacer hoy?</h1>
      <p className="mt-2 max-w-2xl text-[16px] leading-[1.4] text-[var(--muted)]">
        {APP_NAME} mira lo que publican los referentes de RRHH y te dice qué está funcionando y por qué.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {DOORS.map((door) => (
          <Link
            key={door.href}
            href={door.href}
            className="flex flex-col rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-4)] transition-shadow hover:shadow-[var(--shadow-8)]"
          >
            <span className="flex items-center gap-2 text-[18px] font-semibold leading-[1.4] text-[var(--text)]">
              {door.title}
              {door.soon ? (
                <span className="rounded-full bg-[var(--surface-sunk)] px-2 text-[10px] font-normal leading-[1.6] text-[var(--faint)]">
                  pronto
                </span>
              ) : null}
            </span>
            <span className="mt-2 text-[14px] leading-[1.4] text-[var(--muted)]">{door.body}</span>
            <span className="mt-auto pt-4 text-[14px] font-semibold text-[var(--brand-ink)]">Entrar →</span>
          </Link>
        ))}
      </div>

      {posts.length ? (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-[24px] font-semibold leading-[1.4]">Lo que más rindió</h2>
            <Link href="/discovery" className="shrink-0 text-[14px] font-semibold text-[var(--brand-ink)] hover:underline">
              Ver toda la inspiración →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.slice(0, 3).map((post) => (
              <PostCard key={post.id} post={post} why={whyItWorked(post, syntheses)} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
