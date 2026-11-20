import { Badge, SectionLabel } from "@/components/ui";
import { label } from "@/lib/content/labels";
import { type OwnBrandComparison } from "@/lib/content/types";

/**
 * Lo nuestro contra los patrones del mercado. Lo calcula el motor sobre los
 * posts de los referentes, así que es la parte de Insights propios con más
 * respaldo: no depende de nuestros 75 posts sino de miles del mercado.
 *
 * Los hallazgos van separados y con su propio encabezado. Antes se emitían
 * como párrafos unidos con " · ", o sea la parte más accionable de la app
 * formateada como un CSV.
 */
export function OwnBrand({ cmp }: { cmp: OwnBrandComparison }) {
  if (!cmp.own_posts) return null;
  const share = (n: number) => `${Math.round(n * 100)}% de lo nuestro`;
  const x = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1).replace(".", ",")}×`;

  const blocks = [
    {
      title: "Funcionan y casi no usamos",
      items: cmp.missing_patterns.map((p) => ({ text: `Arrancar con ${label(p.key)}`, detail: `${x(p.lift)} · ${share(p.own_share)}` })),
      tone: "brand" as const,
    },
    {
      title: "Formatos que funcionan y casi no publicamos",
      items: (cmp.missing_formats ?? []).map((f) => ({ text: label(f.key), detail: `${x(f.lift)} · ${share(f.own_share)}` })),
      tone: "brand" as const,
    },
    {
      title: "Temas que funcionan y no tocamos",
      items: cmp.missing_themes.map((t) => ({ text: label(t.key), detail: x(t.lift) })),
      tone: "brand" as const,
    },
    {
      title: "Usamos mucho, sin evidencia de que rinda",
      items: cmp.overused_patterns.map((p) => ({ text: `Arrancar con ${label(p.key)}`, detail: share(p.own_share) })),
      tone: "muted" as const,
    },
  ].filter((b) => b.items.length);

  if (!blocks.length) {
    return (
      <p className="text-[14px] leading-[1.4] text-[var(--muted)]">Sin diferencias claras contra los patrones de este mercado.</p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {blocks.map((block) => (
        <div key={block.title}>
          <SectionLabel>{block.title}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {block.items.map((item) => (
              <Badge key={item.text} tone={block.tone}>
                {item.text} <span className="tabular-nums opacity-70">· {item.detail}</span>
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
