import { redirect } from "next/navigation";

/** Fuentes se fusionó con Métricas en /sistema. El link viejo sigue andando. */
export default function SourcesPage() {
  redirect("/sistema?tab=fuentes");
}
