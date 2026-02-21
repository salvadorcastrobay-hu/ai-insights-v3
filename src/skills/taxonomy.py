"""
Taxonomy completa para Humand Sales Insights v2.
Fuente unica de verdad para categorias, modulos, pains, features, competidores.

This is a pure skill module: no I/O, no external dependencies.
"""

from __future__ import annotations

# ──────────────────────────────────────────────
# HR Categories
# ──────────────────────────────────────────────
HR_CATEGORIES = {
    "internal_communication":    {"display_name": "Comunicacion Interna",          "sort_order": 1},
    "hr_administration":         {"display_name": "Administracion de RRHH",        "sort_order": 2},
    "talent_acquisition":        {"display_name": "Atraccion de Talento",          "sort_order": 3},
    "talent_development":        {"display_name": "Desarrollo de Talento",         "sort_order": 4},
    "employee_experience":       {"display_name": "Experiencia del Empleado",      "sort_order": 5},
    "compensation_and_benefits": {"display_name": "Compensaciones y Beneficios",   "sort_order": 6},
    "operations_and_workplace":  {"display_name": "Operaciones y Lugar de Trabajo","sort_order": 7},
}

# ──────────────────────────────────────────────
# Modules (39)
# ──────────────────────────────────────────────
MODULES = {
    # internal_communication
    "chat":                     {"display_name": "Chat",                       "hr_category": "internal_communication", "status": "existing", "sort_order": 1},
    "internal_social_network":  {"display_name": "Red Social Interna",         "hr_category": "internal_communication", "status": "existing", "sort_order": 2},
    "magazine":                 {"display_name": "Revista Interna",            "hr_category": "internal_communication", "status": "existing", "sort_order": 3},
    "live_streaming":           {"display_name": "Streaming en Vivo",          "hr_category": "internal_communication", "status": "existing", "sort_order": 4},
    "knowledge_libraries":      {"display_name": "Biblioteca de Conocimiento", "hr_category": "internal_communication", "status": "existing", "sort_order": 5},
    "quick_links":              {"display_name": "Accesos Rapidos",            "hr_category": "internal_communication", "status": "existing", "sort_order": 6},
    # hr_administration
    "digital_employee_file":    {"display_name": "Legajo Digital",             "hr_category": "hr_administration", "status": "existing", "sort_order": 7},
    "documents":                {"display_name": "Documentos",                 "hr_category": "hr_administration", "status": "existing", "sort_order": 8},
    "files":                    {"display_name": "Archivos",                   "hr_category": "hr_administration", "status": "existing", "sort_order": 9},
    "company_policies":         {"display_name": "Politicas de Empresa",       "hr_category": "hr_administration", "status": "existing", "sort_order": 10},
    "forms_and_workflows":      {"display_name": "Formularios y Flujos",       "hr_category": "hr_administration", "status": "existing", "sort_order": 11},
    "org_chart":                {"display_name": "Organigrama",                "hr_category": "hr_administration", "status": "existing", "sort_order": 12},
    "digital_access":           {"display_name": "Accesos Digitales",          "hr_category": "hr_administration", "status": "existing", "sort_order": 13},
    "security_and_privacy":     {"display_name": "Seguridad y Privacidad",     "hr_category": "hr_administration", "status": "existing", "sort_order": 14},
    "payroll":                  {"display_name": "Nomina / Payroll",           "hr_category": "hr_administration", "status": "missing",  "sort_order": 15},
    # talent_acquisition
    "internal_job_postings":    {"display_name": "Vacantes Internas",          "hr_category": "talent_acquisition", "status": "existing", "sort_order": 16},
    "referral_program":         {"display_name": "Programa de Referidos",      "hr_category": "talent_acquisition", "status": "existing", "sort_order": 17},
    "onboarding":               {"display_name": "Onboarding",                 "hr_category": "talent_acquisition", "status": "existing", "sort_order": 18},
    "ats":                      {"display_name": "ATS",                        "hr_category": "talent_acquisition", "status": "missing",  "sort_order": 19},
    "ai_recruiter":             {"display_name": "Reclutador con IA",          "hr_category": "talent_acquisition", "status": "missing",  "sort_order": 20},
    "recruitment":              {"display_name": "Reclutamiento y Seleccion",  "hr_category": "talent_acquisition", "status": "missing",  "sort_order": 21},
    # talent_development
    "performance_review":       {"display_name": "Evaluacion de Desempeno",    "hr_category": "talent_development", "status": "existing", "sort_order": 22},
    "goals_and_okrs":           {"display_name": "Objetivos y OKRs",           "hr_category": "talent_development", "status": "existing", "sort_order": 23},
    "development_plan":         {"display_name": "Plan de Desarrollo",         "hr_category": "talent_development", "status": "existing", "sort_order": 24},
    "learning":                 {"display_name": "Capacitacion / LMS",         "hr_category": "talent_development", "status": "existing", "sort_order": 25},
    "succession_planning":      {"display_name": "Planes de Sucesion",         "hr_category": "talent_development", "status": "missing",  "sort_order": 26},
    "prebuilt_courses":         {"display_name": "Cursos Listos",              "hr_category": "talent_development", "status": "missing",  "sort_order": 27},
    # employee_experience
    "people_experience":        {"display_name": "Experiencia de Empleado",    "hr_category": "employee_experience", "status": "existing", "sort_order": 28},
    "surveys":                  {"display_name": "Encuestas",                  "hr_category": "employee_experience", "status": "existing", "sort_order": 29},
    "kudos":                    {"display_name": "Reconocimientos",            "hr_category": "employee_experience", "status": "existing", "sort_order": 30},
    "birthdays_and_anniversaries": {"display_name": "Cumpleanos y Aniversarios","hr_category": "employee_experience","status": "existing", "sort_order": 31},
    "events":                   {"display_name": "Eventos",                    "hr_category": "employee_experience", "status": "existing", "sort_order": 32},
    # compensation_and_benefits
    "perks_and_benefits":       {"display_name": "Beneficios y Perks",         "hr_category": "compensation_and_benefits", "status": "existing", "sort_order": 33},
    "marketplace":              {"display_name": "Marketplace",                "hr_category": "compensation_and_benefits", "status": "existing", "sort_order": 34},
    "benefits_platform":        {"display_name": "Plataforma de Beneficios",   "hr_category": "compensation_and_benefits", "status": "missing",  "sort_order": 35},
    # operations_and_workplace
    "time_off":                 {"display_name": "Vacaciones y Licencias",     "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 36},
    "time_tracking":            {"display_name": "Control Horario",            "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 37},
    "space_reservation":        {"display_name": "Reserva de Espacios",        "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 38},
    "service_management":       {"display_name": "Mesa de Servicios",          "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 39},
}

# ──────────────────────────────────────────────
# Insight Types
# ──────────────────────────────────────────────
INSIGHT_TYPES = {
    "pain":               "Dolor / Problema",
    "product_gap":        "Feature Faltante",
    "competitive_signal": "Senal Competitiva",
    "deal_friction":      "Friccion del Deal",
    "faq":                "Pregunta Frecuente",
}

# ──────────────────────────────────────────────
# Pain Subtypes (87 total: 43 general + 44 module-linked)
# ──────────────────────────────────────────────
# module=None means general pain

PAIN_SUBTYPES = {
    # ── General: technology (8) ──
    "fragmented_tools":        {"display_name": "Herramientas fragmentadas",  "theme": "technology",  "module": None, "description": "Multiples herramientas desconectadas"},
    "low_adoption":            {"display_name": "Baja adopcion",              "theme": "technology",  "module": None, "description": "Herramientas actuales con baja adopcion"},
    "no_mobile_access":        {"display_name": "Sin acceso movil",           "theme": "technology",  "module": None, "description": "Sin acceso movil a herramientas HR"},
    "outdated_technology":     {"display_name": "Tecnologia obsoleta",        "theme": "technology",  "module": None, "description": "Sistema legacy o desactualizado"},
    "integration_issues":      {"display_name": "Problemas de integracion",   "theme": "technology",  "module": None, "description": "No se integra con sistemas existentes"},
    "vendor_fatigue":          {"display_name": "Fatiga de proveedores",      "theme": "technology",  "module": None, "description": "Demasiados proveedores de software"},
    "poor_ux":                 {"display_name": "UX deficiente",              "theme": "technology",  "module": None, "description": "Interfaz poco intuitiva"},
    "it_dependency":           {"display_name": "Dependencia de IT",          "theme": "technology",  "module": None, "description": "Cada cambio requiere intervencion de IT"},
    # ── General: processes (6) ──
    "manual_processes":        {"display_name": "Procesos manuales",          "theme": "processes",   "module": None, "description": "Procesos en papel o Excel"},
    "process_bottlenecks":     {"display_name": "Cuellos de botella",         "theme": "processes",   "module": None, "description": "Flujos de aprobacion lentos"},
    "manager_burden":          {"display_name": "Sobrecarga de managers",     "theme": "processes",   "module": None, "description": "Managers gastan tiempo en admin HR"},
    "employee_self_service":   {"display_name": "Sin autogestion",            "theme": "processes",   "module": None, "description": "Empleados no pueden gestionar tramites"},
    "hr_admin_overload":       {"display_name": "HR saturado en operacion",   "theme": "processes",   "module": None, "description": "HR sin tiempo para estrategia"},
    "paper_waste":             {"display_name": "Desperdicio de papel",       "theme": "processes",   "module": None, "description": "Costos de impresion y almacenamiento"},
    # ── General: communication (6) ──
    "communication_gaps":      {"display_name": "Brechas de comunicacion",    "theme": "communication","module": None, "description": "Informacion no llega a todos"},
    "deskless_exclusion":      {"display_name": "Exclusion de deskless",      "theme": "communication","module": None, "description": "Trabajadores sin escritorio excluidos"},
    "email_unreachable":       {"display_name": "Sin email corporativo",      "theme": "communication","module": None, "description": "Empleados sin email ni acceso a intranet"},
    "information_asymmetry":   {"display_name": "Asimetria de informacion",   "theme": "communication","module": None, "description": "Oficina informada, operarios no"},
    "internal_comm_overload":  {"display_name": "Sobrecarga de canales",      "theme": "communication","module": None, "description": "Demasiados canales de comunicacion"},
    "multi_site_silos":        {"display_name": "Silos entre sedes",          "theme": "communication","module": None, "description": "Cada sede es un silo de informacion"},
    # ── General: talent (2) ──
    "turnover_retention":      {"display_name": "Alta rotacion",              "theme": "talent",      "module": None, "description": "Rotacion alta especialmente en frontline"},
    "employer_brand":          {"display_name": "Marca empleadora debil",     "theme": "talent",      "module": None, "description": "Dificultad para atraer talento"},
    # ── General: engagement (4) ──
    "cultural_disconnection":  {"display_name": "Desconexion cultural",       "theme": "engagement",  "module": None, "description": "Empleados desconectados de la cultura"},
    "language_barriers":       {"display_name": "Barreras de idioma",         "theme": "engagement",  "module": None, "description": "Workforce multiidioma sin soporte"},
    "no_sense_of_belonging":   {"display_name": "Sin sentido de pertenencia", "theme": "engagement",  "module": None, "description": "Empleados no sienten pertenencia"},
    "remote_hybrid_challenges":{"display_name": "Desafios remoto/hibrido",   "theme": "engagement",  "module": None, "description": "Gestion de workforce remoto/hibrido"},
    # ── General: data (5) ──
    "poor_visibility":         {"display_name": "Falta de visibilidad",       "theme": "data",        "module": None, "description": "Sin datos sobre la fuerza laboral"},
    "reporting_limitations":   {"display_name": "Reportes limitados",         "theme": "data",        "module": None, "description": "No puede generar reportes necesarios"},
    "data_silos":              {"display_name": "Silos de datos",             "theme": "data",        "module": None, "description": "Datos en sistemas sin vision unificada"},
    "manual_reporting":        {"display_name": "Reportes manuales",          "theme": "data",        "module": None, "description": "Reportes en Excel, toma horas"},
    "no_real_time_data":       {"display_name": "Sin datos en tiempo real",   "theme": "data",        "module": None, "description": "Sin visibilidad real-time"},
    # ── General: compliance (12) ──
    "scaling_pain":            {"display_name": "No escala",                  "theme": "compliance",  "module": None, "description": "Solucion no escala con crecimiento"},
    "compliance_risk":         {"display_name": "Riesgo de compliance",       "theme": "compliance",  "module": None, "description": "Riesgo de incumplimiento regulatorio"},
    "labor_law_complexity":    {"display_name": "Complejidad legal laboral",  "theme": "compliance",  "module": None, "description": "Leyes laborales por pais"},
    "government_reporting":    {"display_name": "Reportes al gobierno",       "theme": "compliance",  "module": None, "description": "Reportes obligatorios"},
    "multi_country_complexity":{"display_name": "Complejidad multi-pais",     "theme": "compliance",  "module": None, "description": "Regulaciones distintas entre paises"},
    "data_privacy":            {"display_name": "Privacidad de datos",        "theme": "compliance",  "module": None, "description": "Preocupaciones LGPD/GDPR"},
    "audit_readiness":         {"display_name": "Auditoria sin preparar",     "theme": "compliance",  "module": None, "description": "No preparado para auditorias"},
    "cost_burden":             {"display_name": "Costo excesivo",             "theme": "compliance",  "module": None, "description": "Costo total de herramientas alto"},
    "security_concerns":       {"display_name": "Seguridad de datos",         "theme": "compliance",  "module": None, "description": "Seguridad de datos de empleados"},
    "union_relations":         {"display_name": "Relaciones sindicales",      "theme": "compliance",  "module": None, "description": "Complejidad con sindicatos"},
    "seasonal_workforce":      {"display_name": "Workforce estacional",       "theme": "compliance",  "module": None, "description": "Gestion de trabajadores estacionales"},
    "contractor_management":   {"display_name": "Gestion de contratistas",    "theme": "compliance",  "module": None, "description": "Administracion de tercerizados"},

    # ── Module-linked: internal_communication (6) ──
    "informal_channel_use":    {"display_name": "Canales informales",         "theme": "communication","module": "chat",                    "description": "WhatsApp/canales personales para trabajo"},
    "top_down_only":           {"display_name": "Solo top-down",              "theme": "communication","module": "internal_social_network", "description": "Sin canal para que empleados se expresen"},
    "fragmented_news":         {"display_name": "Noticias dispersas",         "theme": "communication","module": "magazine",                "description": "Noticias internas dispersas sin canal central"},
    "crisis_communication":    {"display_name": "Sin canal de crisis",        "theme": "communication","module": "live_streaming",           "description": "Sin mecanismo para comunicar en emergencias"},
    "scattered_knowledge":     {"display_name": "Conocimiento disperso",      "theme": "communication","module": "knowledge_libraries",     "description": "Conocimiento sin repositorio central"},
    "resource_findability":    {"display_name": "Recursos inaccesibles",      "theme": "communication","module": "quick_links",             "description": "Empleados no encuentran recursos"},
    # ── Module-linked: hr_administration (9) ──
    "paper_based_records":     {"display_name": "Legajos en papel",           "theme": "processes",   "module": "digital_employee_file",   "description": "Archivos fisicos sin digitalizar"},
    "document_chaos":          {"display_name": "Caos documental",            "theme": "processes",   "module": "documents",               "description": "Documentos sin control de version"},
    "file_disorganization":    {"display_name": "Archivos desorganizados",    "theme": "processes",   "module": "files",                   "description": "Archivos sin estructura ni permisos"},
    "policy_unacknowledged":   {"display_name": "Politicas sin acuse",        "theme": "processes",   "module": "company_policies",        "description": "No se puede probar aceptacion de politicas"},
    "manual_approvals":        {"display_name": "Aprobaciones manuales",      "theme": "processes",   "module": "forms_and_workflows",     "description": "Aprobaciones sin flujo digital"},
    "org_opacity":             {"display_name": "Estructura opaca",           "theme": "processes",   "module": "org_chart",               "description": "No se sabe quien es quien"},
    "access_friction":         {"display_name": "Accesos sin gestion",        "theme": "processes",   "module": "digital_access",          "description": "Gestion manual de permisos"},
    "data_exposure_risk":      {"display_name": "Riesgo de exposicion",       "theme": "processes",   "module": "security_and_privacy",    "description": "Datos sensibles sin controles"},
    "payroll_complexity":      {"display_name": "Complejidad de nomina",      "theme": "processes",   "module": "payroll",                 "description": "Errores o procesos manuales en nomina"},
    # ── Module-linked: talent_acquisition (6) ──
    "no_internal_mobility":    {"display_name": "Sin movilidad interna",      "theme": "talent",      "module": "internal_job_postings",   "description": "Empleados no ven vacantes internas"},
    "untapped_referrals":      {"display_name": "Referidos desaprovechados",  "theme": "talent",      "module": "referral_program",        "description": "Sin mecanismo de referidos"},
    "onboarding_delays":       {"display_name": "Onboarding deficiente",      "theme": "talent",      "module": "onboarding",              "description": "Proceso lento o no estandarizado"},
    "manual_candidate_tracking":{"display_name":"Tracking manual candidatos", "theme": "talent",      "module": "ats",                     "description": "Seguimiento manual de candidatos"},
    "screening_overload":      {"display_name": "Sobrecarga de screening",    "theme": "talent",      "module": "ai_recruiter",            "description": "Filtrado manual consume mucho tiempo"},
    "recruitment_disorganization":{"display_name":"Seleccion desorganizada",  "theme": "talent",      "module": "recruitment",             "description": "Proceso de seleccion desestructurado"},
    # ── Module-linked: talent_development (8) ──
    "no_performance_tracking": {"display_name": "Sin evaluacion desempeno",   "theme": "talent",      "module": "performance_review",      "description": "Sin evaluacion formal de desempeno"},
    "skill_gap_blind":         {"display_name": "Skills gaps invisibles",     "theme": "talent",      "module": "performance_review",      "description": "No se pueden identificar gaps de skills"},
    "misaligned_goals":        {"display_name": "Objetivos desalineados",     "theme": "talent",      "module": "goals_and_okrs",          "description": "Objetivos sin seguimiento"},
    "no_career_path":          {"display_name": "Sin plan de carrera",        "theme": "talent",      "module": "development_plan",        "description": "Empleados no ven oportunidades"},
    "training_gaps":           {"display_name": "Brechas de capacitacion",    "theme": "talent",      "module": "learning",                "description": "No puede capacitar de forma efectiva"},
    "training_compliance":     {"display_name": "Sin tracking formativo",     "theme": "talent",      "module": "learning",                "description": "Capacitaciones obligatorias sin tracking"},
    "succession_risk":         {"display_name": "Riesgo de sucesion",         "theme": "talent",      "module": "succession_planning",     "description": "Personas clave sin sucesor"},
    "no_training_content":     {"display_name": "Sin contenido formativo",    "theme": "talent",      "module": "prebuilt_courses",        "description": "Sin cursos listos para capacitar"},
    # ── Module-linked: employee_experience (6) ──
    "poor_employee_journey":   {"display_name": "Journey fragmentado",        "theme": "engagement",  "module": "people_experience",       "description": "Experiencia del empleado fragmentada"},
    "engagement_blind_spot":   {"display_name": "Engagement sin medir",       "theme": "engagement",  "module": "surveys",                 "description": "No hay forma de medir clima"},
    "feedback_absence":        {"display_name": "Sin feedback continuo",      "theme": "engagement",  "module": "surveys",                 "description": "Sin mecanismo de feedback continuo"},
    "recognition_deficit":     {"display_name": "Falta de reconocimiento",    "theme": "engagement",  "module": "kudos",                   "description": "Sin mecanismo para reconocer logros"},
    "milestones_ignored":      {"display_name": "Hitos sin celebrar",         "theme": "engagement",  "module": "birthdays_and_anniversaries","description": "No se celebran cumpleanos ni aniversarios"},
    "event_disorganization":   {"display_name": "Eventos desorganizados",     "theme": "engagement",  "module": "events",                  "description": "Sin gestion centralizada de eventos"},
    # ── Module-linked: compensation_and_benefits (3) ──
    "manual_benefits_enrollment":{"display_name":"Alta manual beneficios",    "theme": "compensation","module": "perks_and_benefits",      "description": "Inscripcion manual a beneficios"},
    "perks_invisible":         {"display_name": "Perks sin visibilidad",      "theme": "compensation","module": "marketplace",             "description": "Empleados desconocen beneficios"},
    "benefits_fragmentation":  {"display_name": "Beneficios dispersos",       "theme": "compensation","module": "benefits_platform",       "description": "Beneficios en multiples sistemas"},
    # ── Module-linked: operations_and_workplace (6) ──
    "absence_management":      {"display_name": "Ausencias sin control",      "theme": "operations",  "module": "time_off",                "description": "Sin visibilidad de ausencias"},
    "time_attendance_chaos":   {"display_name": "Asistencia sin control",     "theme": "operations",  "module": "time_tracking",           "description": "Problemas con fichaje o asistencia"},
    "shift_scheduling":        {"display_name": "Turnos sin planificar",      "theme": "operations",  "module": "time_tracking",           "description": "Complejidad planificando turnos"},
    "overtime_compliance":     {"display_name": "Horas extra sin control",    "theme": "operations",  "module": "time_tracking",           "description": "Horas extra sin control"},
    "space_conflicts":         {"display_name": "Conflictos de espacios",     "theme": "operations",  "module": "space_reservation",       "description": "Sin sistema de reserva de espacios"},
    "no_service_desk":         {"display_name": "Sin mesa de servicios",      "theme": "operations",  "module": "service_management",      "description": "Sin mesa de servicios digital"},
}

# ──────────────────────────────────────────────
# Deal Friction Subtypes
# ──────────────────────────────────────────────
DEAL_FRICTION_SUBTYPES = {
    "budget":               {"display_name": "Restriccion presupuestaria",  "description": "Limitaciones de presupuesto"},
    "timing":               {"display_name": "Timing desalineado",          "description": "No es el momento"},
    "decision_maker":       {"display_name": "Falta decisor",               "description": "Falta stakeholder clave"},
    "legal":                {"display_name": "Revision legal/compliance",   "description": "DPA, revision legal, procurement"},
    "technical":            {"display_name": "Complejidad tecnica",         "description": "SSO, APIs, requisitos de IT"},
    "change_management":    {"display_name": "Resistencia al cambio",       "description": "Preocupacion por adopcion"},
    "champion_risk":        {"display_name": "Champion en riesgo",          "description": "Champion debil o cambiando"},
    "incumbent_lock_in":    {"display_name": "Contrato existente",          "description": "Atado a vendor actual"},
    "scope_mismatch":       {"display_name": "Alcance insuficiente",        "description": "No cubre todos los requerimientos"},
    "security_review":      {"display_name": "Revision de seguridad",       "description": "Evaluacion infosec requerida"},
    "regional_requirements":{"display_name": "Requisitos regionales",       "description": "Necesidades de pais no cubiertas"},
    "competing_priorities": {"display_name": "Prioridades competidoras",    "description": "Otros proyectos compiten"},
}

# ──────────────────────────────────────────────
# FAQ Subtypes
# ──────────────────────────────────────────────
FAQ_SUBTYPES = {
    "pricing":            {"display_name": "Precios",                 "description": "Modelo de pricing, costo por usuario"},
    "implementation":     {"display_name": "Implementacion",          "description": "Timeline, esfuerzo, metodologia"},
    "integration":        {"display_name": "Integraciones",           "description": "Conexion con sistemas existentes"},
    "security":           {"display_name": "Seguridad",               "description": "Certificaciones, hosting, SOC 2"},
    "customization":      {"display_name": "Personalizacion",         "description": "White-label, branding, config"},
    "mobile":             {"display_name": "App Movil",               "description": "Capacidades de la app nativa"},
    "support":            {"display_name": "Soporte",                 "description": "SLA, soporte post-lanzamiento"},
    "migration":          {"display_name": "Migracion de datos",      "description": "Importacion desde herramienta anterior"},
    "scalability":        {"display_name": "Escalabilidad",           "description": "Capacidad para miles de usuarios"},
    "analytics":          {"display_name": "Analytics y reportes",    "description": "Dashboards, exportacion, metricas"},
    "languages":          {"display_name": "Idiomas",                 "description": "Soporte multi-idioma"},
    "adoption":           {"display_name": "Adopcion",                "description": "Estrategias y tasas tipicas"},
    "compliance":         {"display_name": "Compliance regulatorio",  "description": "GDPR, LGPD, leyes locales"},
    "roi":                {"display_name": "ROI y business case",     "description": "Retorno de inversion, casos de exito"},
    "content_management": {"display_name": "Gestion de contenido",    "description": "Permisos, publicacion, programacion"},
}

# ──────────────────────────────────────────────
# Competitive Relationships
# ──────────────────────────────────────────────
COMPETITIVE_RELATIONSHIPS = {
    "currently_using": {"display_name": "Usa actualmente",  "description": "El prospecto usa este competidor hoy"},
    "evaluating":      {"display_name": "Evaluando",        "description": "Evaluando en paralelo"},
    "migrating_from":  {"display_name": "Migrando desde",   "description": "Dejando este competidor"},
    "comparing":       {"display_name": "Comparando",       "description": "Compara features/precio"},
    "mentioned":       {"display_name": "Mencionado",       "description": "Mencion sin senal fuerte"},
    "previously_used": {"display_name": "Uso antes",        "description": "Lo uso en el pasado"},
}

# ──────────────────────────────────────────────
# Competitors
# ──────────────────────────────────────────────
COMPETITORS = {
    # LATAM
    "Buk": "latam", "Factorial": "latam", "Pandape": "latam", "Rankmi": "latam",
    "GoIntegro": "latam", "Visma": "latam", "Workplace (Meta)": "latam",
    "Microsoft Viva Engage": "latam", "HiBob": "latam", "Lapzo": "latam",
    "Workvivo": "latam", "Indigital": "latam", "Esigtek": "latam",
    "Defontana": "latam", "Novasoft": "latam", "PeopleForce": "latam",
    "Sesame HR": "latam", "Talento Zeus": "latam", "Worky": "latam",
    "Tress": "latam", "Fortia": "latam", "Meta4 (Cegid)": "latam",
    "Digitalware": "latam", "Heinsohn": "latam", "SAP SuccessFactors": "latam",
    "Workday": "latam", "Crehana": "latam", "UBits": "latam",
    "Talento Cloud": "latam", "Connecto": "latam", "Solides": "latam",
    "Dialog": "latam", "Convenia": "latam", "Beehome": "latam",
    "Alest": "latam", "Comunitive": "latam", "Hywork": "latam",
    # EMEA
    "Beekeeper": "emea", "Flip": "emea", "Staffbase": "emea", "Sage": "emea",
    "Bizneo": "emea", "Sesame": "emea", "Blink": "emea", "Sociabble": "emea",
    "Zucchetti": "emea", "Yoobic": "emea", "Personio": "emea",
    # North America
    "Simpplr": "north_america", "Firstup": "north_america",
    "Igloo Software": "north_america", "LumApps": "north_america",
    "Unily": "north_america", "Haiilo": "north_america",
    "Interact": "north_america", "Jostle": "north_america",
    "Poppulo": "north_america", "Connecteam": "north_america",
    "Assembly": "north_america", "BambooHR": "north_america",
    "Paylocity": "north_america", "Rippling": "north_america",
    "Culture Amp": "north_america", "Qualtrics": "north_america",
    "Lattice": "north_america", "15Five": "north_america",
    "WorkTango": "north_america", "Glint": "north_america",
    "Microsoft Teams": "north_america", "Slack": "north_america",
    "Google Workspace": "north_america", "SharePoint": "north_america",
    "Speakapp": "north_america", "Workable": "north_america",
    # APAC
    "Workjam": "apac", "Lark": "apac", "Simplrr": "apac", "Weconnect": "apac",
}

# ──────────────────────────────────────────────
# Feature Names (seed list for product_gap)
# ──────────────────────────────────────────────
SEED_FEATURE_NAMES = {
    "payroll_integration":      {"display_name": "Integracion de nomina",      "suggested_module": "payroll"},
    "ats_module":               {"display_name": "Modulo de ATS",              "suggested_module": "ats"},
    "ai_recruiter":             {"display_name": "Reclutador con IA",          "suggested_module": "ai_recruiter"},
    "succession_planning":      {"display_name": "Planes de sucesion",         "suggested_module": "succession_planning"},
    "native_benefits_platform": {"display_name": "Plataforma de beneficios",   "suggested_module": "benefits_platform"},
    "prebuilt_courses":         {"display_name": "Cursos listos",              "suggested_module": "prebuilt_courses"},
    "recruitment_module":       {"display_name": "Modulo de seleccion",        "suggested_module": "recruitment"},
    "advanced_analytics":       {"display_name": "Analytics avanzado",         "suggested_module": None},
    "bi_dashboard":             {"display_name": "Dashboard BI",               "suggested_module": None},
    "sso_integration":          {"display_name": "Integracion SSO",            "suggested_module": "security_and_privacy"},
    "api_access":               {"display_name": "Acceso API",                 "suggested_module": "digital_access"},
    "offline_mode":             {"display_name": "Modo offline",               "suggested_module": None},
    "multi_language_content":   {"display_name": "Contenido multi-idioma",     "suggested_module": None},
    "shift_scheduling":         {"display_name": "Planificacion de turnos",    "suggested_module": "time_tracking"},
    "geofencing":               {"display_name": "Geofencing",                 "suggested_module": "time_tracking"},
    "expense_management":       {"display_name": "Gestion de gastos",          "suggested_module": None},
    "compensation_management":  {"display_name": "Gestion de compensaciones",  "suggested_module": None},
    "nine_box_grid":            {"display_name": "Nine box grid",              "suggested_module": "performance_review"},
    "scorm_support":            {"display_name": "Soporte SCORM",              "suggested_module": "learning"},
    "whatsapp_integration":     {"display_name": "Integracion WhatsApp",       "suggested_module": "chat"},
    "sap_integration":          {"display_name": "Integracion SAP",            "suggested_module": None},
    "workday_integration":      {"display_name": "Integracion Workday",        "suggested_module": None},
    "custom_branding":          {"display_name": "Branding personalizado",     "suggested_module": None},
    "push_notifications":       {"display_name": "Notificaciones push",        "suggested_module": None},
    "video_conferencing":       {"display_name": "Videoconferencia",           "suggested_module": "live_streaming"},
    "ai_chatbot":               {"display_name": "Chatbot con IA",             "suggested_module": "chat"},
    "predictive_analytics":     {"display_name": "Analytics predictivo",       "suggested_module": None},
    "employee_wellness":        {"display_name": "Bienestar del empleado",     "suggested_module": "people_experience"},
    "exit_interviews":          {"display_name": "Entrevistas de salida",      "suggested_module": "surveys"},
    "anonymous_feedback":       {"display_name": "Feedback anonimo",           "suggested_module": "surveys"},
}

# ──────────────────────────────────────────────
# Module Aliases (for LLM normalization)
# ──────────────────────────────────────────────
MODULE_ALIASES = {
    # chat
    "chat interno": "chat", "mensajeria interna": "chat", "mensajes directos": "chat",
    "chat de empleados": "chat", "centro de mensajes": "chat",
    "chat interno": "chat", "mensagens": "chat", "im": "chat", "dm": "chat",
    # internal_social_network
    "red social interna": "internal_social_network", "muro social": "internal_social_network",
    "comunidades internas": "internal_social_network", "feed social": "internal_social_network",
    # magazine
    "revista interna": "magazine", "newsletter": "magazine", "noticias internas": "magazine",
    "boletin interno": "magazine",
    # live_streaming
    "streaming en vivo": "live_streaming", "transmision en vivo": "live_streaming",
    "town hall": "live_streaming", "all hands": "live_streaming",
    # knowledge_libraries
    "biblioteca de conocimiento": "knowledge_libraries", "base de conocimiento": "knowledge_libraries",
    "wiki interna": "knowledge_libraries", "knowledge base": "knowledge_libraries",
    # quick_links
    "accesos rapidos": "quick_links", "enlaces rapidos": "quick_links",
    # digital_employee_file
    "legajo digital": "digital_employee_file", "expediente digital": "digital_employee_file",
    "ficha del empleado": "digital_employee_file",
    # documents
    "documentos": "documents", "gestion documental": "documents",
    # files
    "archivos": "files", "file manager": "files",
    # company_policies
    "politicas de empresa": "company_policies", "politicas corporativas": "company_policies",
    "reglamento interno": "company_policies",
    # forms_and_workflows
    "formularios y flujos": "forms_and_workflows", "flujos de aprobacion": "forms_and_workflows",
    "circuitos de aprobacion": "forms_and_workflows", "workflows": "forms_and_workflows",
    "formularios e fluxos": "forms_and_workflows", "aprovacoes": "forms_and_workflows",
    # org_chart
    "organigrama": "org_chart", "estructura organizacional": "org_chart",
    # digital_access
    "accesos digitales": "digital_access", "gestion de accesos": "digital_access",
    # security_and_privacy
    "seguridad y privacidad": "security_and_privacy", "seguridad": "security_and_privacy",
    # payroll
    "nomina": "payroll", "payroll": "payroll", "liquidacion de sueldos": "payroll",
    "recibos de sueldo": "payroll",
    # internal_job_postings
    "vacantes internas": "internal_job_postings", "bolsa de trabajo interna": "internal_job_postings",
    "movilidad interna": "internal_job_postings",
    # referral_program
    "programa de referidos": "referral_program", "referidos": "referral_program",
    # onboarding
    "onboarding": "onboarding", "induccion": "onboarding", "integracion inicial": "onboarding",
    "ruta de onboarding": "onboarding", "bienvenida": "onboarding",
    "integracao": "onboarding", "onboarding de colaboradores": "onboarding",
    # ats
    "ats": "ats", "tracking de candidatos": "ats", "applicant tracking": "ats",
    # ai_recruiter
    "reclutador con ia": "ai_recruiter", "reclutamiento ia": "ai_recruiter",
    # recruitment
    "reclutamiento y seleccion": "recruitment", "seleccion de personal": "recruitment",
    "reclutamiento": "recruitment",
    # performance_review
    "evaluacion de desempeno": "performance_review", "revision de desempeno": "performance_review",
    "medicion de desempeno": "performance_review", "avaliacao de desempenho": "performance_review",
    "performance review": "performance_review",
    # goals_and_okrs
    "objetivos y okrs": "goals_and_okrs", "okrs": "goals_and_okrs", "objetivos": "goals_and_okrs",
    # development_plan
    "plan de desarrollo": "development_plan", "plan de carrera": "development_plan",
    "desarrollo profesional": "development_plan",
    # learning
    "capacitacion": "learning", "formacion": "learning", "cursos": "learning",
    "campus digital": "learning", "centro de aprendizaje": "learning", "lms": "learning",
    "treinamento": "learning", "capacitacao": "learning", "plataforma de cursos": "learning",
    # succession_planning
    "planes de sucesion": "succession_planning", "sucesion": "succession_planning",
    # prebuilt_courses
    "cursos listos": "prebuilt_courses", "cursos propios": "prebuilt_courses",
    "contenido formativo": "prebuilt_courses",
    # people_experience
    "experiencia de empleado": "people_experience", "employee experience": "people_experience",
    # surveys
    "encuestas": "surveys", "pulse surveys": "surveys", "encuestas de clima": "surveys",
    "enps": "surveys",
    # kudos
    "reconocimientos": "kudos", "kudos": "kudos", "programa de reconocimiento": "kudos",
    # birthdays_and_anniversaries
    "cumpleanos y aniversarios": "birthdays_and_anniversaries",
    "cumpleanos": "birthdays_and_anniversaries",
    # events
    "eventos": "events", "gestion de eventos": "events",
    # perks_and_benefits
    "beneficios y perks": "perks_and_benefits", "beneficios": "perks_and_benefits",
    "perks": "perks_and_benefits",
    # marketplace
    "marketplace": "marketplace", "tienda de beneficios": "marketplace",
    "marketplace de descuentos": "marketplace",
    # benefits_platform
    "plataforma de beneficios": "benefits_platform",
    # time_off
    "vacaciones y licencias": "time_off", "vacaciones": "time_off", "permisos": "time_off",
    "novedades": "time_off", "solicitud de permiso": "time_off", "pto": "time_off",
    "ferias": "time_off", "afastamentos": "time_off", "licencas": "time_off",
    # time_tracking
    "control horario": "time_tracking", "fichaje": "time_tracking",
    "reloj checador": "time_tracking", "marcacion digital": "time_tracking",
    "control de asistencia": "time_tracking",
    "controle de ponto": "time_tracking", "registro de horas": "time_tracking",
    # space_reservation
    "reserva de espacios": "space_reservation", "reserva de salas": "space_reservation",
    # service_management
    "mesa de servicios": "service_management", "ticketing": "service_management",
    "service desk": "service_management", "gestion de tickets": "service_management",
    "central de atendimento": "service_management", "chamados": "service_management",
}

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def get_valid_pain_codes() -> set[str]:
    return set(PAIN_SUBTYPES.keys())

def get_valid_deal_friction_codes() -> set[str]:
    return set(DEAL_FRICTION_SUBTYPES.keys())

def get_valid_faq_codes() -> set[str]:
    return set(FAQ_SUBTYPES.keys())

def get_valid_competitive_relationship_codes() -> set[str]:
    return set(COMPETITIVE_RELATIONSHIPS.keys())

def get_valid_module_codes() -> set[str]:
    return set(MODULES.keys())

def get_valid_feature_codes() -> set[str]:
    return set(SEED_FEATURE_NAMES.keys())

def get_competitor_names() -> set[str]:
    return set(COMPETITORS.keys())

def get_module_for_pain(pain_code: str) -> str | None:
    pain = PAIN_SUBTYPES.get(pain_code)
    return pain["module"] if pain else None

def normalize_competitor(name: str) -> str | None:
    """Try to match a competitor name case-insensitively."""
    lower = name.lower().strip()
    for canonical in COMPETITORS:
        if canonical.lower() == lower:
            return canonical
    # Fuzzy: check if input is contained in any canonical name
    for canonical in COMPETITORS:
        if lower in canonical.lower() or canonical.lower() in lower:
            return canonical
    return name  # Return as-is if no match
