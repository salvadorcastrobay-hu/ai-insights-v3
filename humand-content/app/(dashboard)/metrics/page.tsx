import { redirect } from "next/navigation";

/** Métricas se fusionó con Fuentes en /sistema. El link viejo sigue andando. */
export default function MetricsPage() {
  redirect("/sistema?tab=metricas");
}
