import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/pages/common";
import { ChartCard } from "@/components/charts/ChartCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";

// ─── Insight types ────────────────────────────────────────────
const INSIGHT_TYPES: Array<{ code: string; display: string; description: string; example: string }> = [
  {
    code: "pain",
    display: "Dolor / Problema",
    description: "El prospecto describe una frustración o necesidad operativa actual.",
    example: '"Hoy las licencias se piden por mail, las apruebo y las cargo manualmente."',
  },
  {
    code: "product_gap",
    display: "Feature Faltante",
    description: "El prospecto pide una funcionalidad que no existe o no le alcanza.",
    example: '"Necesitamos integración automática con nuestro sistema de nómina."',
  },
  {
    code: "competitive_signal",
    display: "Señal Competitiva",
    description: "Se menciona un competidor — lo usan, lo evalúan, migran o lo descartaron.",
    example: '"Hoy estamos con SAP SuccessFactors pero no nos termina de funcionar."',
  },
  {
    code: "deal_friction",
    display: "Fricción del Deal",
    description: "Algo que frena o bloquea el avance comercial (presupuesto, timing, decisor, etc.).",
    example: '"Ya planificamos el presupuesto del año, esto entra recién en 2026."',
  },
  {
    code: "faq",
    display: "Pregunta Frecuente",
    description: "Una pregunta del prospecto sobre el producto, proceso o pricing.",
    example: '"¿Cómo se hace la implementación? ¿Cuánto tiempo lleva?"',
  },
];

// ─── Pain themes ──────────────────────────────────────────────
const PAIN_THEMES: Array<{ theme: string; description: string }> = [
  { theme: "processes", description: "Procesos manuales, cuellos de botella, sobrecarga operativa." },
  { theme: "technology", description: "Herramientas fragmentadas, baja adopción, falta de integración." },
  { theme: "communication", description: "La info no llega, deskless excluidos, silos entre sedes." },
  { theme: "data", description: "Falta de visibilidad, reportes limitados, sin datos en tiempo real." },
  { theme: "talent", description: "Rotación, marca empleadora, gestión del ciclo de vida del empleado." },
  { theme: "engagement", description: "Desconexión cultural, falta de pertenencia, reconocimiento." },
  { theme: "compliance", description: "Riesgo regulatorio, leyes laborales, auditorías." },
  { theme: "operations", description: "Asistencia, turnos, ausencias, espacios físicos." },
  { theme: "compensation", description: "Beneficios, perks, marketplace, plataformas de beneficios." },
];

// ─── Friction subtypes ────────────────────────────────────────
const FRICTION_SUBTYPES: Array<{ code: string; display: string; description: string }> = [
  { code: "budget", display: "Restricción presupuestaria", description: "Limitaciones de presupuesto." },
  { code: "timing", display: "Timing desalineado", description: "No es el momento; calendario interno o ventana de compra desfasada." },
  { code: "decision_maker", display: "Falta decisor", description: "Falta el stakeholder clave para avanzar." },
  { code: "legal", display: "Revisión legal/compliance", description: "DPA, revisión legal o procurement." },
  { code: "technical", display: "Complejidad técnica", description: "SSO, APIs, requisitos de IT." },
  { code: "change_management", display: "Resistencia al cambio", description: "Preocupación por adopción interna." },
  { code: "champion_risk", display: "Champion en riesgo", description: "Champion débil o que cambia de rol." },
  { code: "incumbent_lock_in", display: "Contrato existente", description: "Atado a un vendor actual." },
  { code: "scope_mismatch", display: "Alcance insuficiente", description: "No cubre todos los requerimientos." },
  { code: "security_review", display: "Revisión de seguridad", description: "Evaluación InfoSec requerida." },
  { code: "regional_requirements", display: "Requisitos regionales", description: "Necesidades específicas de país no cubiertas." },
  { code: "competing_priorities", display: "Prioridades competidoras", description: "Otros proyectos compiten por foco." },
];

// ─── FAQ subtypes ─────────────────────────────────────────────
const FAQ_SUBTYPES: Array<{ code: string; display: string; description: string }> = [
  { code: "pricing", display: "Precios", description: "Modelo de pricing, costo por usuario." },
  { code: "implementation", display: "Implementación", description: "Timeline, esfuerzo, metodología." },
  { code: "integration", display: "Integraciones", description: "Conexión con sistemas existentes." },
  { code: "security", display: "Seguridad", description: "Certificaciones, hosting, SOC 2." },
  { code: "customization", display: "Personalización", description: "White-label, branding, configuración." },
  { code: "mobile", display: "App Móvil", description: "Capacidades de la app nativa." },
  { code: "support", display: "Soporte", description: "SLA, soporte post-lanzamiento." },
  { code: "migration", display: "Migración de datos", description: "Importación desde herramienta anterior." },
  { code: "scalability", display: "Escalabilidad", description: "Capacidad para miles de usuarios." },
  { code: "analytics", display: "Analytics y reportes", description: "Dashboards, exportación, métricas." },
  { code: "languages", display: "Idiomas", description: "Soporte multi-idioma." },
  { code: "adoption", display: "Adopción", description: "Estrategias y tasas típicas." },
  { code: "compliance", display: "Compliance regulatorio", description: "GDPR, LGPD, leyes locales." },
  { code: "roi", display: "ROI y business case", description: "Retorno de inversión, casos de éxito." },
  { code: "content_management", display: "Gestión de contenido", description: "Permisos, publicación, programación." },
];

// ─── Competitive relationships ────────────────────────────────
const COMPETITIVE_RELATIONSHIPS: Array<{ display: string; description: string; color: string; action: string }> = [
  { display: "Usa actualmente", description: "El prospecto lo usa hoy.", color: "#E53935", action: "Desplazamiento activo, máxima prioridad." },
  { display: "Evaluando", description: "Lo evalúa en paralelo con Humand.", color: "#FB8C00", action: "Necesita battle card específica." },
  { display: "Migrando desde", description: "Lo está dejando.", color: "#FDD835", action: "Oportunidad activa, acelerar." },
  { display: "Uso anterior", description: "Lo usó en el pasado.", color: "#43A047", action: "Aprender por qué lo dejaron." },
  { display: "Mencionado", description: "Mención sin señal fuerte.", color: "#1E88E5", action: "Señal débil, no actuar sin más contexto." },
  { display: "Descartado", description: "Lo evaluó y descartó.", color: "#424242", action: "Win para Humand, documentar el motivo." },
];

// ─── Gap priorities ───────────────────────────────────────────
const GAP_PRIORITIES: Array<{ code: string; display: string; description: string }> = [
  { code: "must_have", display: "⚠️ Must Have", description: "Funcionalidad necesaria pero no bloqueante. Es razón fuerte para evaluar." },
  { code: "nice_to_have", display: "💡 Nice to Have", description: "Deseable pero el deal puede avanzar sin esto." },
  { code: "dealbreaker", display: "🚫 Dealbreaker", description: "Sin esto, el deal no avanza. La ausencia ya impidió cerrar." },
];

// ─── HR Categories + Modules ──────────────────────────────────
type ModuleStatus = "existing" | "missing" | "roadmap";
type ModuleRow = { en: string; es: string; status: ModuleStatus };

const MODULES_BY_CATEGORY: Array<{ category: string; display: string; modules: ModuleRow[] }> = [
  {
    category: "internal_communication",
    display: "Comunicación Interna",
    modules: [
      { en: "Chat", es: "Chat", status: "existing" },
      { en: "Internal Social Network", es: "Red Social Interna", status: "existing" },
      { en: "Magazine", es: "Noticias", status: "existing" },
      { en: "Live Streaming", es: "Live Streaming", status: "existing" },
      { en: "Knowledge Libraries", es: "Biblioteca de Recursos", status: "existing" },
      { en: "Quick Links", es: "Accesos Rápidos", status: "existing" },
      { en: "Calls", es: "Llamadas", status: "existing" },
      { en: "Feed", es: "Feed", status: "existing" },
    ],
  },
  {
    category: "hr_administration",
    display: "Administración de RRHH",
    modules: [
      { en: "Digital Employee File", es: "Expediente digital del colaborador", status: "existing" },
      { en: "Documents", es: "Documentos", status: "existing" },
      { en: "Files", es: "Archivos", status: "roadmap" },
      { en: "Company Policies", es: "Políticas", status: "existing" },
      { en: "Forms & Workflows", es: "Formularios, trámites y aprobaciones", status: "existing" },
      { en: "Org Chart", es: "Organigrama", status: "existing" },
      { en: "Digital Access", es: "Acceso con ID", status: "existing" },
      { en: "Security & Privacy", es: "Seguridad y Privacidad", status: "existing" },
      { en: "Payroll", es: "Nómina", status: "roadmap" },
    ],
  },
  {
    category: "talent_acquisition",
    display: "Atracción de Talento",
    modules: [
      { en: "Internal Job Postings", es: "Búsquedas internas", status: "existing" },
      { en: "Referral Program", es: "Programa de Referidos", status: "existing" },
      { en: "Onboarding", es: "Onboarding", status: "existing" },
      { en: "Recruitment", es: "Reclutamiento y Selección", status: "roadmap" },
      { en: "ATS", es: "ATS", status: "existing" },
      { en: "AI Recruiter", es: "Reclutador con IA", status: "roadmap" },
    ],
  },
  {
    category: "talent_development",
    display: "Desarrollo de Talento",
    modules: [
      { en: "Performance Review", es: "Evaluación de Desempeño", status: "existing" },
      { en: "Goals & OKRs", es: "Objetivos y Resultados Clave", status: "existing" },
      { en: "Development Plan", es: "Plan de carrera", status: "existing" },
      { en: "Learning", es: "Aprendizaje", status: "existing" },
      { en: "Succession Planning", es: "Planes de Sucesión", status: "missing" },
      { en: "Prebuilt Courses", es: "Cursos Listos", status: "missing" },
      { en: "Trainings", es: "Capacitaciones Presenciales", status: "existing" },
    ],
  },
  {
    category: "culture_and_engagement",
    display: "Cultura y Engagement",
    modules: [
      { en: "People Experience", es: "People Experience", status: "existing" },
      { en: "Surveys", es: "Encuestas", status: "existing" },
      { en: "Kudos", es: "Reconocimientos", status: "existing" },
      { en: "Birthdays & Anniversaries", es: "Cumpleaños y Aniversarios", status: "existing" },
      { en: "Events", es: "Eventos", status: "existing" },
      { en: "Prode", es: "Prode", status: "roadmap" },
    ],
  },
  {
    category: "compensation_and_benefits",
    display: "Compensaciones y Beneficios",
    modules: [
      { en: "Perks & Benefits", es: "Beneficios", status: "existing" },
      { en: "Marketplace", es: "Marketplace", status: "existing" },
      { en: "Benefits Administration", es: "Administración de Beneficios Flex", status: "missing" },
      { en: "Benefits Platform", es: "Plataforma de Beneficios", status: "missing" },
      { en: "Microloans", es: "Microcréditos", status: "existing" },
    ],
  },
  {
    category: "operations_and_workplace",
    display: "Operaciones y Lugar de Trabajo",
    modules: [
      { en: "Time Off", es: "Vacaciones y Permisos", status: "existing" },
      { en: "Time Tracking", es: "Control de Asistencia", status: "existing" },
      { en: "Space Reservation", es: "Reserva de espacios", status: "existing" },
      { en: "Service Management", es: "Gestión de Servicios", status: "existing" },
      { en: "Time Planning", es: "Planificación de Turnos", status: "existing" },
    ],
  },
  {
    category: "platform",
    display: "Plataforma",
    modules: [
      { en: "Roles & Permissions", es: "Roles & Permisos", status: "existing" },
      { en: "Integrations", es: "Integraciones", status: "existing" },
      { en: "Insights", es: "Insights", status: "existing" },
      { en: "Users", es: "Usuarios", status: "existing" },
      { en: "Groups", es: "Grupos", status: "existing" },
      { en: "Auth", es: "Autenticación", status: "existing" },
      { en: "Notification Center", es: "Centro de Notificaciones", status: "existing" },
      { en: "Profile", es: "Perfil", status: "existing" },
    ],
  },
];

const STATUS_STYLES: Record<ModuleStatus, { label: string; bg: string; fg: string }> = {
  existing: { label: "Existente", bg: "#dcfce7", fg: "#166534" },
  missing: { label: "Faltante", bg: "#fee2e2", fg: "#991b1b" },
  roadmap: { label: "En roadmap", bg: "#fef3c7", fg: "#92400e" },
};

// ─── Segmentation dimensions ──────────────────────────────────
const REGIONS = [
  { name: "HISPAM", description: "Hispanoamérica (Argentina, México, Colombia, Chile, Perú, etc.)" },
  { name: "Brazil", description: "Brasil." },
  { name: "ANGLO AMERICA", description: "EE.UU. y Canadá." },
  { name: "EMEA", description: "Europa, Medio Oriente y África." },
  { name: "APAC", description: "Asia Pacífico." },
  { name: "MENA", description: "Medio Oriente y Norte de África." },
];

const SEGMENTS = [
  { name: "SMB", range: "< 250 empleados", description: "Pequeñas y medianas." },
  { name: "Mid Market", range: "250–1,000 empleados", description: "Empresas medianas en crecimiento." },
  { name: "Enterprise", range: "1,001–3,000 empleados", description: "Cuentas grandes." },
  { name: "Large Enterprise", range: "> 3,000 empleados", description: "Las más grandes, suelen requerir mayor personalización." },
];

const ACQUISITION_CHANNELS = [
  { name: "Inbound", description: "El lead llegó por iniciativa propia (marketing, web, eventos, referrals, paid)." },
  { name: "Outbound", description: "Lead generado por BDR / AE / CX en outreach activo." },
  { name: "Partner / Referral", description: "Vino vía un partner, alianza o referido de cliente." },
  { name: "Otros", description: "No clasifica claramente en las tres anteriores." },
];

// ─── KPIs ─────────────────────────────────────────────────────
const KPIS: Array<{ name: string; formula: string; notes: string }> = [
  { name: "Insights por Call", formula: "total_insights / unique_transcripts", notes: "Promedio simple." },
  { name: "Transcripts", formula: "count(distinct transcript_id)", notes: "Calls procesadas en el recorte actual." },
  { name: "Deals con Match", formula: "count(distinct deal_id)", notes: "Calls cruzadas con un deal de HubSpot." },
  { name: "Revenue Total", formula: "sum(distinct deal.amount)", notes: "Suma de amount por deal único." },
  { name: "Calls con Insights", formula: "(transcripts_con_insight / total_transcripts) × 100", notes: "% de cobertura del pipeline." },
  { name: "Revenue en Riesgo", formula: "sum(distinct deal.amount where deal tiene fricción / gap)", notes: "Dedup por deal." },
  { name: "Fricciones por deal", formula: "total_fricciones / deals_afectados", notes: "Solo considera deals con al menos una fricción." },
  { name: "% deals con feature gap", formula: "(deals_con_gap / total_deals_filtrados) × 100", notes: "Visible en Product Gaps." },
];

// ─── Pages ────────────────────────────────────────────────────
const PAGES: Array<{ name: string; purpose: string; audience: string }> = [
  { name: "Executive Summary", purpose: "Foto general de las demos en una sola pantalla.", audience: "Todos. Punto de entrada." },
  { name: "Product Intelligence", purpose: "Pains, módulos y feature gaps con detalle por theme y segmento.", audience: "Producto." },
  { name: "Competitive Intelligence", purpose: "Quién compite, cómo nos comparan, dónde hay oportunidad de migración.", audience: "Marketing y Sales." },
  { name: "Sales Enablement", purpose: "Fricciones por deal, performance por AE, battle cards.", audience: "Sales y Enablement." },
  { name: "Regional / GTM", purpose: "Diferencias por mercado: pains, features, revenue por región.", audience: "Regional Leads, GTM Strategy." },
  { name: "Pains Detail", purpose: "Investigación cualitativa profunda con citas reales.", audience: "Producto y Research." },
  { name: "Product Gaps Detail", purpose: "Inventario de features faltantes con prioridad y revenue.", audience: "Producto." },
  { name: "FAQ Detail", purpose: "Preguntas frecuentes por topic — base para Knowledge Base.", audience: "Enablement y Marketing." },
  { name: "Comparative Analysis", purpose: "Comparar periodos, regiones, segmentos o canales.", audience: "Strategy." },
  { name: "Custom Dashboards", purpose: "Constructor de gráficos a medida, persistidos por usuario.", audience: "Cualquiera con un caso de uso específico." },
  { name: "Chat con IA", purpose: "Preguntas libres sobre toda la base — SQL + búsqueda semántica.", audience: "Todos." },
  { name: "Campaign Advisor", purpose: "Genera propuestas de campaña basadas en los insights de un perfil.", audience: "Marketing (rol campaign_advisor)." },
];

// ─── Cross-cutting features ───────────────────────────────────
const CROSS_FEATURES: Array<{ name: string; description: string; tip: string }> = [
  { name: "Filtros globales", description: "Recortan el dataset para todas las páginas. Persisten en la URL.", tip: "Copiá la URL para compartir la vista con alguien." },
  { name: "Drill-down", description: "Click en cualquier barra abre un panel con las calls e insights detrás.", tip: "Sirve para ir del agregado a la cita textual en dos clicks." },
  { name: "Preguntar al gráfico", description: "Botón en cada chart. Pregunta libre que se responde con citas reales.", tip: "Es ideal para preguntas tipo '¿a qué se refieren con X?'." },
  { name: "CSV", description: "Descarga los datos del gráfico (mismas filas que ves en pantalla).", tip: "Útil para llevarlo a una QBR o presentación externa." },
  { name: "Cmd + K", description: "Atajo para abrir el panel general de Preguntar.", tip: "Útil para preguntar sobre la página entera, no un chart puntual." },
];

// ─── Roles ────────────────────────────────────────────────────
const ROLES: Array<{ role: string; can: string }> = [
  { role: "admin", can: "Todo: dashboard completo + Campaign Advisor + administración." },
  { role: "campaign_advisor", can: "Dashboard completo + Campaign Advisor." },
  { role: "viewer", can: "Dashboard completo (sin Campaign Advisor)." },
];

// ─── Buenas prácticas ─────────────────────────────────────────
const BEST_PRACTICES: Array<{ title: string; body: string }> = [
  {
    title: "Mirá la composición de la muestra antes de sacar conclusiones",
    body: "Si filtraste algo muy específico (ej. Industry = Hospitality + Country = Perú), puede que la muestra sea muy chica. Revisá la sección Composición en Executive Summary primero.",
  },
  {
    title: "Agregado miente, citas no",
    body: "Cuando algo te llame la atención en un chart, clickeá la barra para abrir el drill-down y leé las citas reales. Los números agregados dan dirección, las verbatim dan certeza.",
  },
  {
    title: "Distingue volumen de impacto",
    body: "Un pain que aparece mucho no necesariamente vale más que uno que aparece poco si el segundo está concentrado en deals de alto revenue. Cruzá siempre Top Pains con Revenue en Riesgo.",
  },
  {
    title: "Tipos de relación competitiva no son simétricos",
    body: "'Usa actualmente' es alta prioridad de desplazamiento; 'Mencionado' es ruido hasta que no haya más contexto. No los sumes en un solo número.",
  },
  {
    title: "Filtrá por etapa para deals más útiles",
    body: "Las fricciones en Discovery son distintas a las de Final Negotiation. Si estás haciendo enablement, mirá las de las etapas tardías (perdidos / postponed) primero.",
  },
];

export async function GlossaryPage() {
  const t = await getTranslations("glossary");
  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />

      {/* INSIGHT TYPES */}
      <div className="space-y-3">
        <SectionHeader title="Tipos de insight" description="Las 5 categorías que el pipeline extrae de cada call." />
        <ChartCard>
          <Table>
            <Thead>
              <Tr><Th>Código</Th><Th>Nombre</Th><Th>Definición</Th><Th>Ejemplo</Th></Tr>
            </Thead>
            <Tbody>
              {INSIGHT_TYPES.map((it) => (
                <Tr key={it.code}>
                  <Td><code className="text-[12px]">{it.code}</code></Td>
                  <Td className="font-semibold">{it.display}</Td>
                  <Td>{it.description}</Td>
                  <Td className="italic text-[var(--color-text-secondary)]">{it.example}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* PAIN THEMES */}
      <div className="space-y-3">
        <SectionHeader title="Themes de pains" description="Los pains se agrupan en estos macro-temas. Aparecen en todos los heatmaps de Product Intelligence y Pains Detail." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Theme</Th><Th>Qué cubre</Th></Tr></Thead>
            <Tbody>
              {PAIN_THEMES.map((p) => (
                <Tr key={p.theme}><Td className="font-semibold">{p.theme}</Td><Td>{p.description}</Td></Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* FRICTION SUBTYPES */}
      <div className="space-y-3">
        <SectionHeader title="Tipos de fricción del deal" description="Las 12 fricciones canónicas que el modelo detecta en deal_friction." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Código</Th><Th>Display</Th><Th>Descripción</Th></Tr></Thead>
            <Tbody>
              {FRICTION_SUBTYPES.map((f) => (
                <Tr key={f.code}>
                  <Td><code className="text-[12px]">{f.code}</code></Td>
                  <Td className="font-semibold">{f.display}</Td>
                  <Td>{f.description}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* FAQ SUBTYPES */}
      <div className="space-y-3">
        <SectionHeader title="Topics de FAQs" description="Los 15 topics que agrupan las preguntas frecuentes." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Código</Th><Th>Display</Th><Th>Descripción</Th></Tr></Thead>
            <Tbody>
              {FAQ_SUBTYPES.map((f) => (
                <Tr key={f.code}>
                  <Td><code className="text-[12px]">{f.code}</code></Td>
                  <Td className="font-semibold">{f.display}</Td>
                  <Td>{f.description}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* COMPETITIVE RELATIONSHIPS */}
      <div className="space-y-3">
        <SectionHeader title="Tipos de relación competitiva" description="Cómo el modelo categoriza la relación del prospect con cada competidor mencionado." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Tipo</Th><Th>Qué significa</Th><Th>Acción sugerida</Th></Tr></Thead>
            <Tbody>
              {COMPETITIVE_RELATIONSHIPS.map((r) => (
                <Tr key={r.display}>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: r.color }} />
                      <span className="font-semibold">{r.display}</span>
                    </span>
                  </Td>
                  <Td>{r.description}</Td>
                  <Td className="text-[var(--color-text-secondary)]">{r.action}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* GAP PRIORITIES */}
      <div className="space-y-3">
        <SectionHeader title="Prioridades de feature gaps" description="Cómo el modelo etiqueta la urgencia de un feature pedido por el prospect." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Prioridad</Th><Th>Significado</Th></Tr></Thead>
            <Tbody>
              {GAP_PRIORITIES.map((p) => (
                <Tr key={p.code}><Td className="font-semibold">{p.display}</Td><Td>{p.description}</Td></Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* MODULES */}
      <div className="space-y-3">
        <SectionHeader title="Módulos del producto" description="Listado completo agrupado por categoría HR, con su status actual y nomenclatura oficial (inglés / español)." />
        <ChartCard>
          <div className="space-y-5">
            {MODULES_BY_CATEGORY.map((cat) => (
              <div key={cat.category}>
                <h4 className="mb-2 text-[14px] font-semibold text-[var(--color-text-default)]">{cat.display}</h4>
                <Table>
                  <Thead>
                    <Tr>
                      <Th className="w-[35%]">English</Th>
                      <Th className="w-[40%]">Español</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {cat.modules.map((m) => {
                      const style = STATUS_STYLES[m.status];
                      return (
                        <Tr key={m.en}>
                          <Td className="font-medium">{m.en}</Td>
                          <Td>{m.es}</Td>
                          <Td>
                            <span
                              className="inline-block rounded-full px-2 py-[2px] text-[11px] font-semibold"
                              style={{ backgroundColor: style.bg, color: style.fg }}
                            >
                              {style.label}
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
            <strong>Existente</strong>: el módulo ya está en producción. <strong>En roadmap</strong>: lo vamos a construir. <strong>Faltante</strong>: no está disponible y no está priorizado todavía.
          </p>
        </ChartCard>
      </div>

      {/* REGIONS + SEGMENTS + CHANNELS */}
      <div className="space-y-3">
        <SectionHeader title="Dimensiones de corte" description="Las regiones, segmentos comerciales y canales de adquisición que se usan en filtros y cruces." />
        <section className="grid gap-3 lg:grid-cols-3">
          <ChartCard title="Regiones">
            <Table>
              <Thead><Tr><Th>Región</Th><Th>Cubre</Th></Tr></Thead>
              <Tbody>
                {REGIONS.map((r) => (
                  <Tr key={r.name}><Td className="font-semibold">{r.name}</Td><Td>{r.description}</Td></Tr>
                ))}
              </Tbody>
            </Table>
          </ChartCard>
          <ChartCard title="Segmentos comerciales">
            <Table>
              <Thead><Tr><Th>Segmento</Th><Th>Tamaño</Th></Tr></Thead>
              <Tbody>
                {SEGMENTS.map((s) => (
                  <Tr key={s.name}><Td className="font-semibold">{s.name}</Td><Td>{s.range}</Td></Tr>
                ))}
              </Tbody>
            </Table>
          </ChartCard>
          <ChartCard title="Canales de adquisición">
            <Table>
              <Thead><Tr><Th>Canal</Th><Th>Descripción</Th></Tr></Thead>
              <Tbody>
                {ACQUISITION_CHANNELS.map((c) => (
                  <Tr key={c.name}><Td className="font-semibold">{c.name}</Td><Td>{c.description}</Td></Tr>
                ))}
              </Tbody>
            </Table>
          </ChartCard>
        </section>
      </div>

      {/* KPIs */}
      <div className="space-y-3">
        <SectionHeader title="Métricas y cómo se calculan" description="Las fórmulas detrás de los números que aparecen en los KPIs." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Métrica</Th><Th>Fórmula</Th><Th>Notas</Th></Tr></Thead>
            <Tbody>
              {KPIS.map((k) => (
                <Tr key={k.name}>
                  <Td className="font-semibold">{k.name}</Td>
                  <Td><code className="text-[12px]">{k.formula}</code></Td>
                  <Td className="text-[var(--color-text-secondary)]">{k.notes}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
            <strong>Menciones</strong> cuenta cada insight individualmente. <strong>Deals únicos</strong> deduplica por <code>deal_id</code>: si una misma feature aparece en 3 calls del mismo deal, cuenta como 1.
          </p>
        </ChartCard>
      </div>

      {/* PAGES */}
      <div className="space-y-3">
        <SectionHeader title="Mapa de páginas" description="Qué hay en cada sección y para quién está pensada." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Página</Th><Th>Para qué sirve</Th><Th>Audiencia principal</Th></Tr></Thead>
            <Tbody>
              {PAGES.map((p) => (
                <Tr key={p.name}>
                  <Td className="font-semibold">{p.name}</Td>
                  <Td>{p.purpose}</Td>
                  <Td className="text-[var(--color-text-secondary)]">{p.audience}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* CROSS FEATURES */}
      <div className="space-y-3">
        <SectionHeader title="Funcionalidades transversales" description="Acciones disponibles desde varias páginas." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Función</Th><Th>Qué hace</Th><Th>Tip</Th></Tr></Thead>
            <Tbody>
              {CROSS_FEATURES.map((f) => (
                <Tr key={f.name}>
                  <Td className="font-semibold">{f.name}</Td>
                  <Td>{f.description}</Td>
                  <Td className="text-[var(--color-text-secondary)]">{f.tip}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* ROLES */}
      <div className="space-y-3">
        <SectionHeader title="Roles" description="Qué puede ver y hacer cada tipo de usuario." />
        <ChartCard>
          <Table>
            <Thead><Tr><Th>Rol</Th><Th>Acceso</Th></Tr></Thead>
            <Tbody>
              {ROLES.map((r) => (
                <Tr key={r.role}>
                  <Td><code className="text-[12px] font-semibold">{r.role}</code></Td>
                  <Td>{r.can}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
      </div>

      {/* BEST PRACTICES */}
      <div className="space-y-3">
        <SectionHeader title="Cómo leer los datos" description="Buenas prácticas para no llegar a conclusiones equivocadas." />
        <section className="grid gap-3 md:grid-cols-2">
          {BEST_PRACTICES.map((b) => (
            <ChartCard key={b.title} title={b.title}>
              <p className="text-[13px] text-[var(--color-text-secondary)]">{b.body}</p>
            </ChartCard>
          ))}
        </section>
      </div>
    </div>
  );
}
