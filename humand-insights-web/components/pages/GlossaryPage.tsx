import { PageTitle } from "@/components/pages/common";
import { ChartCard } from "@/components/charts/ChartCard";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";

const INSIGHT_TYPES = [
  ["pain", "Problema detectado en la conversación comercial."],
  ["product_gap", "Feature o módulo faltante solicitado por el prospect."],
  ["competitive_signal", "Mención o comparación con competidores."],
  ["deal_friction", "Bloqueo para avanzar el deal (precio, timing, integración, etc.)."],
  ["faq", "Pregunta frecuente expresada por el prospect."],
];

const KPI_TERMS = [
  ["Insights por Call", "Promedio de insights detectados por transcript."],
  ["Calls con Insights", "Porcentaje de transcripts con al menos un insight."],
  ["Revenue en Riesgo", "Revenue asociado a deals con fricción o gaps."],
  ["Feature Frequency", "Cantidad de deals/transcripts que pidieron una feature."],
];

export function GlossaryPage() {
  return (
    <div className="space-y-6">
      <PageTitle title="Glossary" subtitle="Definiciones rápidas para interpretar métricas y visualizaciones." />

      <ChartCard title="Insight Types">
        <Table>
          <Thead><Tr><Th>Código</Th><Th>Definición</Th></Tr></Thead>
          <Tbody>
            {INSIGHT_TYPES.map(([code, definition]) => (
              <Tr key={code}><Td>{code}</Td><Td>{definition}</Td></Tr>
            ))}
          </Tbody>
        </Table>
      </ChartCard>

      <ChartCard title="KPIs">
        <Table>
          <Thead><Tr><Th>KPI</Th><Th>Definición</Th></Tr></Thead>
          <Tbody>
            {KPI_TERMS.map(([kpi, definition]) => (
              <Tr key={kpi}><Td>{kpi}</Td><Td>{definition}</Td></Tr>
            ))}
          </Tbody>
        </Table>
      </ChartCard>

      <ChartCard title="Lectura de gráficos">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Bar charts muestran ranking por frecuencia o revenue. Heatmaps muestran intensidad relativa por combinación de dos dimensiones.
          Las anotaciones en celdas reflejan recuento o porcentaje según la página.
        </p>
      </ChartCard>
    </div>
  );
}
