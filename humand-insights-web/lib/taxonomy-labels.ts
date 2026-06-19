"use client";

import { useLocale } from "next-intl";

type Translations = { pt: string; en: string };

// Static map: Spanish display_name → { pt, en }
// Terms that are identical across all languages are omitted (fallback returns the original).
const LABELS: Record<string, Translations> = {
  // ── HR Categories ──
  "Comunicacion Interna":           { pt: "Comunicação Interna",             en: "Internal Communication" },
  "Administracion de RRHH":         { pt: "Administração de RH",             en: "HR Administration" },
  "Atraccion de Talento":           { pt: "Atração de Talentos",             en: "Talent Acquisition" },
  "Desarrollo de Talento":          { pt: "Desenvolvimento de Talentos",      en: "Talent Development" },
  "Experiencia del Empleado":       { pt: "Experiência do Colaborador",       en: "Employee Experience" },
  "Compensaciones y Beneficios":    { pt: "Remuneração e Benefícios",         en: "Compensation & Benefits" },
  "Operaciones y Lugar de Trabajo": { pt: "Operações e Local de Trabalho",    en: "Operations & Workplace" },
  "Plataforma":                     { pt: "Plataforma",                       en: "Platform" },

  // ── Modules ──
  "Red Social Interna":                    { pt: "Rede Social Interna",                  en: "Internal Social Network" },
  "Noticias":                              { pt: "Notícias",                             en: "News" },
  "Biblioteca de Recursos":                { pt: "Biblioteca de Recursos",               en: "Resource Library" },
  "Accesos Rapidos":                       { pt: "Acesso Rápido",                        en: "Quick Links" },
  "Expediente digital del colaborador":    { pt: "Arquivo digital do colaborador",       en: "Digital Employee File" },
  "Documentos":                            { pt: "Documentos",                           en: "Documents" },
  "Archivos":                              { pt: "Arquivos",                             en: "Files" },
  "Politicas":                             { pt: "Políticas",                            en: "Policies" },
  "Formularios, tramites y aprobaciones":  { pt: "Formulários, processos e aprovações",  en: "Forms, Workflows & Approvals" },
  "Organigrama":                           { pt: "Organograma",                          en: "Org Chart" },
  "Acceso con ID":                         { pt: "Acesso com ID",                        en: "Digital Access" },
  "Seguridad y Privacidad":                { pt: "Segurança e Privacidade",              en: "Security & Privacy" },
  "Nomina":                                { pt: "Folha de Pagamento",                   en: "Payroll" },
  "Busquedas internas":                    { pt: "Vagas internas",                       en: "Internal Job Postings" },
  "Programa de Referidos":                 { pt: "Programa de Indicações",               en: "Referral Program" },
  "Reclutador con IA":                     { pt: "Recrutador com IA",                    en: "AI Recruiter" },
  "Reclutamiento y Seleccion":             { pt: "Recrutamento e Seleção",               en: "Recruitment & Selection" },
  "Evaluacion de Desempeno":               { pt: "Avaliação de Desempenho",              en: "Performance Review" },
  "Objetivos y Resultados Clave":          { pt: "Objetivos e Resultados-chave",         en: "Goals & OKRs" },
  "Plan de carrera":                       { pt: "Plano de Carreira",                    en: "Career Plan" },
  "Aprendizaje":                           { pt: "Aprendizagem",                         en: "Learning" },
  "Planes de Sucesion":                    { pt: "Planos de Sucessão",                   en: "Succession Planning" },
  "Cursos Listos":                         { pt: "Cursos Prontos",                       en: "Prebuilt Courses" },
  "Encuestas":                             { pt: "Pesquisas",                            en: "Surveys" },
  "Reconocimientos":                       { pt: "Reconhecimentos",                      en: "Recognition" },
  "Cumpleanos y Aniversarios":             { pt: "Aniversários e Datas Especiais",       en: "Birthdays & Anniversaries" },
  "Eventos":                               { pt: "Eventos",                              en: "Events" },
  "Beneficios":                            { pt: "Benefícios",                           en: "Benefits" },
  "Administracion de Beneficios Flex":     { pt: "Administração de Benefícios Flex",     en: "Flex Benefits Administration" },
  "Plataforma de Beneficios":              { pt: "Plataforma de Benefícios",             en: "Benefits Platform" },
  "Vacaciones y Permisos":                 { pt: "Férias e Licenças",                    en: "Time Off" },
  "Control de Asistencia":                 { pt: "Controle de Ponto",                    en: "Time Tracking" },
  "Reserva de espacios":                   { pt: "Reserva de Espaços",                   en: "Space Reservation" },
  "Gestion de Servicios":                  { pt: "Gestão de Serviços",                   en: "Service Management" },
  "Roles & Permisos":                      { pt: "Funções & Permissões",                 en: "Roles & Permissions" },
  "Integraciones":                         { pt: "Integrações",                          en: "Integrations" },
  "Usuarios":                              { pt: "Usuários",                             en: "Users" },
  "Grupos":                                { pt: "Grupos",                               en: "Groups" },
  "Autenticacion":                         { pt: "Autenticação",                         en: "Authentication" },
  "Centro de Notificaciones":              { pt: "Central de Notificações",              en: "Notification Center" },
  "Perfil":                                { pt: "Perfil",                               en: "Profile" },
  "Llamadas":                              { pt: "Chamadas",                             en: "Calls" },
  "Planificacion de Turnos":               { pt: "Planejamento de Turnos",               en: "Shift Scheduling" },
  "Capacitaciones Presenciales":           { pt: "Treinamentos Presenciais",             en: "In-person Training" },
  "Microcreditos":                         { pt: "Microcréditos",                        en: "Microcredits" },

  // ── Insight Types ──
  "Dolor / Problema":   { pt: "Dor / Problema",       en: "Pain / Problem" },
  "Feature Faltante":   { pt: "Feature Ausente",       en: "Missing Feature" },
  "Senal Competitiva":  { pt: "Sinal Competitivo",     en: "Competitive Signal" },
  "Friccion del Deal":  { pt: "Fricção do Deal",        en: "Deal Friction" },
  "Pregunta Frecuente": { pt: "Pergunta Frequente",    en: "Frequent Question" },

  // ── Pain Subtypes — technology ──
  "Herramientas fragmentadas": { pt: "Ferramentas fragmentadas",   en: "Fragmented tools" },
  "Baja adopcion":             { pt: "Baixa adoção",               en: "Low adoption" },
  "Sin acceso movil":          { pt: "Sem acesso móvel",            en: "No mobile access" },
  "Tecnologia obsoleta":       { pt: "Tecnologia obsoleta",         en: "Outdated technology" },
  "Problemas de integracion":  { pt: "Problemas de integração",     en: "Integration issues" },
  "Fatiga de proveedores":     { pt: "Fadiga de fornecedores",      en: "Vendor fatigue" },
  "UX deficiente":             { pt: "UX deficiente",               en: "Poor UX" },
  "Dependencia de IT":         { pt: "Dependência de TI",           en: "IT dependency" },

  // ── Pain Subtypes — processes ──
  "Procesos manuales":      { pt: "Processos manuais",          en: "Manual processes" },
  "Cuellos de botella":     { pt: "Gargalos",                   en: "Bottlenecks" },
  "Sobrecarga de managers": { pt: "Sobrecarga de gestores",      en: "Manager burden" },
  "Sin autogestion":        { pt: "Sem autogestão",              en: "No self-service" },
  "HR saturado en operacion":{ pt: "RH saturado em operação",   en: "HR overloaded with operations" },
  "Desperdicio de papel":   { pt: "Desperdício de papel",        en: "Paper waste" },

  // ── Pain Subtypes — communication ──
  "Brechas de comunicacion":  { pt: "Lacunas de comunicação",     en: "Communication gaps" },
  "Exclusion de deskless":    { pt: "Exclusão de deskless",        en: "Deskless exclusion" },
  "Sin email corporativo":    { pt: "Sem e-mail corporativo",      en: "No corporate email" },
  "Asimetria de informacion": { pt: "Assimetria de informação",    en: "Information asymmetry" },
  "Sobrecarga de canales":    { pt: "Sobrecarga de canais",        en: "Channel overload" },
  "Silos entre sedes":        { pt: "Silos entre unidades",        en: "Multi-site silos" },

  // ── Pain Subtypes — talent ──
  "Alta rotacion":         { pt: "Alta rotatividade",       en: "High turnover" },
  "Marca empleadora debil":{ pt: "Marca empregadora fraca", en: "Weak employer brand" },

  // ── Pain Subtypes — engagement ──
  "Desconexion cultural":      { pt: "Desconexão cultural",          en: "Cultural disconnection" },
  "Barreras de idioma":        { pt: "Barreiras de idioma",          en: "Language barriers" },
  "Sin sentido de pertenencia":{ pt: "Sem senso de pertencimento",   en: "No sense of belonging" },
  "Desafios remoto/hibrido":   { pt: "Desafios remoto/híbrido",      en: "Remote/hybrid challenges" },

  // ── Pain Subtypes — data ──
  "Falta de visibilidad":    { pt: "Falta de visibilidade",   en: "Poor visibility" },
  "Reportes limitados":      { pt: "Relatórios limitados",    en: "Limited reporting" },
  "Silos de datos":          { pt: "Silos de dados",           en: "Data silos" },
  "Reportes manuales":       { pt: "Relatórios manuais",       en: "Manual reporting" },
  "Sin datos en tiempo real":{ pt: "Sem dados em tempo real",  en: "No real-time data" },

  // ── Pain Subtypes — compliance ──
  "No escala":                 { pt: "Não escala",                    en: "Doesn't scale" },
  "Riesgo de compliance":      { pt: "Risco de compliance",           en: "Compliance risk" },
  "Complejidad legal laboral": { pt: "Complexidade trabalhista",       en: "Labor law complexity" },
  "Reportes al gobierno":      { pt: "Relatórios governamentais",      en: "Government reporting" },
  "Complejidad multi-pais":    { pt: "Complexidade multipaís",         en: "Multi-country complexity" },
  "Privacidad de datos":       { pt: "Privacidade de dados",           en: "Data privacy" },
  "Auditoria sin preparar":    { pt: "Auditoria sem preparo",          en: "Audit unreadiness" },
  "Costo excesivo":            { pt: "Custo excessivo",                en: "Excessive cost" },
  "Seguridad de datos":        { pt: "Segurança de dados",             en: "Data security" },
  "Relaciones sindicales":     { pt: "Relações sindicais",             en: "Union relations" },
  "Workforce estacional":      { pt: "Workforce sazonal",              en: "Seasonal workforce" },
  "Gestion de contratistas":   { pt: "Gestão de contratados",          en: "Contractor management" },

  // ── Pain Subtypes — module-linked ──
  "Canales informales":         { pt: "Canais informais",              en: "Informal channels" },
  "Solo top-down":              { pt: "Somente top-down",              en: "Top-down only" },
  "Noticias dispersas":         { pt: "Notícias dispersas",            en: "Scattered news" },
  "Sin canal de crisis":        { pt: "Sem canal de crise",            en: "No crisis channel" },
  "Conocimiento disperso":      { pt: "Conhecimento disperso",         en: "Scattered knowledge" },
  "Recursos inaccesibles":      { pt: "Recursos inacessíveis",         en: "Inaccessible resources" },
  "Legajos en papel":           { pt: "Arquivos em papel",             en: "Paper-based records" },
  "Caos documental":            { pt: "Caos documental",               en: "Document chaos" },
  "Archivos desorganizados":    { pt: "Arquivos desorganizados",       en: "Disorganized files" },
  "Politicas sin acuse":        { pt: "Políticas sem aceite",          en: "Unacknowledged policies" },
  "Aprobaciones manuales":      { pt: "Aprovações manuais",            en: "Manual approvals" },
  "Estructura opaca":           { pt: "Estrutura opaca",               en: "Opaque structure" },
  "Accesos sin gestion":        { pt: "Acessos sem gestão",            en: "Unmanaged access" },
  "Riesgo de exposicion":       { pt: "Risco de exposição",            en: "Data exposure risk" },
  "Complejidad de nomina":      { pt: "Complexidade da folha",         en: "Payroll complexity" },
  "Sin movilidad interna":      { pt: "Sem mobilidade interna",        en: "No internal mobility" },
  "Referidos desaprovechados":  { pt: "Indicações desperdiçadas",      en: "Untapped referrals" },
  "Onboarding deficiente":      { pt: "Onboarding deficiente",         en: "Poor onboarding" },
  "Tracking manual candidatos": { pt: "Tracking manual de candidatos", en: "Manual candidate tracking" },
  "Sobrecarga de screening":    { pt: "Sobrecarga de triagem",         en: "Screening overload" },
  "Seleccion desorganizada":    { pt: "Seleção desorganizada",         en: "Disorganized recruitment" },
  "Sin evaluacion desempeno":   { pt: "Sem avaliação de desempenho",   en: "No performance review" },
  "Skills gaps invisibles":     { pt: "Lacunas de habilidades invisíveis", en: "Invisible skill gaps" },
  "Objetivos desalineados":     { pt: "Objetivos desalinhados",        en: "Misaligned goals" },
  "Sin plan de carrera":        { pt: "Sem plano de carreira",         en: "No career path" },
  "Brechas de capacitacion":    { pt: "Lacunas de capacitação",        en: "Training gaps" },
  "Sin tracking formativo":     { pt: "Sem controle de treinamentos",  en: "No training tracking" },
  "Riesgo de sucesion":         { pt: "Risco de sucessão",             en: "Succession risk" },
  "Sin contenido formativo":    { pt: "Sem conteúdo formativo",        en: "No training content" },
  "Journey fragmentado":        { pt: "Jornada fragmentada",           en: "Fragmented journey" },
  "Engagement sin medir":       { pt: "Engajamento sem mensuração",    en: "Unmeasured engagement" },
  "Sin feedback continuo":      { pt: "Sem feedback contínuo",         en: "No continuous feedback" },
  "Falta de reconocimiento":    { pt: "Falta de reconhecimento",       en: "Lack of recognition" },
  "Hitos sin celebrar":         { pt: "Marcos sem celebração",         en: "Uncelebrated milestones" },
  "Eventos desorganizados":     { pt: "Eventos desorganizados",        en: "Disorganized events" },
  "Alta manual beneficios":     { pt: "Alta manual de benefícios",     en: "Manual benefits enrollment" },
  "Perks sin visibilidad":      { pt: "Perks sem visibilidade",        en: "Invisible perks" },
  "Beneficios dispersos":       { pt: "Benefícios dispersos",          en: "Scattered benefits" },
  "Ausencias sin control":      { pt: "Ausências sem controle",        en: "Untracked absences" },
  "Asistencia sin control":     { pt: "Assiduidade sem controle",      en: "Untracked attendance" },
  "Turnos sin planificar":      { pt: "Turnos sem planejamento",       en: "Unscheduled shifts" },
  "Horas extra sin control":    { pt: "Horas extras sem controle",     en: "Untracked overtime" },
  "Conflictos de espacios":     { pt: "Conflitos de espaços",          en: "Space conflicts" },
  "Sin mesa de servicios":      { pt: "Sem central de serviços",       en: "No service desk" },

  // ── Deal Friction Subtypes ──
  "Restriccion presupuestaria": { pt: "Restrição orçamentária",        en: "Budget constraint" },
  "Timing desalineado":         { pt: "Timing desalinhado",            en: "Misaligned timing" },
  "Falta decisor":              { pt: "Falta de decisor",              en: "Missing decision-maker" },
  "Revision legal/compliance":  { pt: "Revisão jurídica/compliance",   en: "Legal/compliance review" },
  "Complejidad tecnica":        { pt: "Complexidade técnica",           en: "Technical complexity" },
  "Resistencia al cambio":      { pt: "Resistência à mudança",         en: "Change resistance" },
  "Champion en riesgo":         { pt: "Champion em risco",             en: "Champion at risk" },
  "Contrato existente":         { pt: "Contrato existente",            en: "Existing contract" },
  "Alcance insuficiente":       { pt: "Escopo insuficiente",           en: "Insufficient scope" },
  "Revision de seguridad":      { pt: "Revisão de segurança",          en: "Security review" },
  "Requisitos regionales":      { pt: "Requisitos regionais",          en: "Regional requirements" },
  "Prioridades competidoras":   { pt: "Prioridades concorrentes",      en: "Competing priorities" },

  // ── FAQ Subtypes ──
  "Precios":               { pt: "Preços",                     en: "Pricing" },
  "Implementacion":        { pt: "Implementação",              en: "Implementation" },
  "Seguridad":             { pt: "Segurança",                  en: "Security" },
  "Personalizacion":       { pt: "Personalização",             en: "Customization" },
  "App Movil":             { pt: "App Móvel",                  en: "Mobile App" },
  "Soporte":               { pt: "Suporte",                    en: "Support" },
  "Migracion de datos":    { pt: "Migração de dados",          en: "Data migration" },
  "Escalabilidad":         { pt: "Escalabilidade",             en: "Scalability" },
  "Analytics y reportes":  { pt: "Analytics e relatórios",     en: "Analytics & Reporting" },
  "Idiomas":               { pt: "Idiomas",                    en: "Languages" },
  "Adopcion":              { pt: "Adoção",                     en: "Adoption" },
  "Compliance regulatorio":{ pt: "Compliance regulatório",     en: "Regulatory compliance" },
  "ROI y business case":   { pt: "ROI e business case",        en: "ROI & business case" },
  "Gestion de contenido":  { pt: "Gestão de conteúdo",         en: "Content management" },

  // ── Competitive Relationships ──
  "Usa actualmente": { pt: "Usa atualmente",  en: "Currently using" },
  "Evaluando":       { pt: "Avaliando",       en: "Evaluating" },
  "Migrando desde":  { pt: "Migrando de",     en: "Migrating from" },
  "Comparando":      { pt: "Comparando",      en: "Comparing" },
  "Mencionado":      { pt: "Mencionado",      en: "Mentioned" },
  "Uso antes":       { pt: "Usou antes",      en: "Previously used" },

  // ── Seed Feature Names ──
  "Integracion de nomina":    { pt: "Integração de folha",          en: "Payroll integration" },
  "Modulo de ATS":            { pt: "Módulo de ATS",                en: "ATS module" },
  "Planes de sucesion":       { pt: "Planos de Sucessão",           en: "Succession plans" },
  "Plataforma de beneficios": { pt: "Plataforma de Benefícios",     en: "Benefits platform" },
  "Cursos listos":            { pt: "Cursos Prontos",               en: "Prebuilt courses" },
  "Modulo de seleccion":      { pt: "Módulo de Seleção",            en: "Selection module" },
  "Analytics avanzado":       { pt: "Analytics avançado",           en: "Advanced analytics" },
  "Dashboard BI":             { pt: "Dashboard BI",                 en: "BI Dashboard" },
  "Integracion SSO":          { pt: "Integração SSO",               en: "SSO integration" },
  "Acceso API":               { pt: "Acesso API",                   en: "API access" },
  "Modo offline":             { pt: "Modo offline",                 en: "Offline mode" },
  "Contenido multi-idioma":   { pt: "Conteúdo multilíngue",         en: "Multi-language content" },
  "Planificacion de turnos":  { pt: "Planejamento de Turnos",       en: "Shift scheduling" },
  "Gestion de gastos":        { pt: "Gestão de despesas",           en: "Expense management" },
  "Gestion de compensaciones":{ pt: "Gestão de remunerações",       en: "Compensation management" },
  "Integracion WhatsApp":     { pt: "Integração WhatsApp",          en: "WhatsApp integration" },
  "Integracion SAP":          { pt: "Integração SAP",               en: "SAP integration" },
  "Integracion Workday":      { pt: "Integração Workday",           en: "Workday integration" },
  "Branding personalizado":   { pt: "Branding personalizado",       en: "Custom branding" },
  "Notificaciones push":      { pt: "Notificações push",            en: "Push notifications" },
  "Videoconferencia":         { pt: "Videoconferência",             en: "Video conferencing" },
  "Chatbot con IA":           { pt: "Chatbot com IA",               en: "AI chatbot" },
  "Analytics predictivo":     { pt: "Analytics preditivo",          en: "Predictive analytics" },
  "Bienestar del empleado":   { pt: "Bem-estar do colaborador",     en: "Employee wellness" },
  "Entrevistas de salida":    { pt: "Entrevistas de saída",         en: "Exit interviews" },
  "Feedback anonimo":         { pt: "Feedback anônimo",             en: "Anonymous feedback" },
};

/** Translate a taxonomy display label to the given locale. Falls back to the original if not found. */
export function tLabel(label: string, locale: string): string {
  if (!label) return label;
  if (locale === "es") return label;
  const entry = LABELS[label];
  if (!entry) return label;
  return (entry as Record<string, string>)[locale] ?? label;
}

/** React hook: returns a function that translates taxonomy labels for the current locale. */
export function useTaxonomyLabel(): (label: string) => string {
  const locale = useLocale();
  return (label: string) => tLabel(label, locale);
}
