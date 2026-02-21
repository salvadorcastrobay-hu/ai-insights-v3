"""
Taxonomy completa para Humand Sales Insights v3.1.
Fuente unica de verdad para categorias, modulos, pains, features, competidores.

This is a pure skill module: no I/O, no external dependencies.
"""

from __future__ import annotations

# ──────────────────────────────────────────────
# HR Categories (7)
# ──────────────────────────────────────────────
HR_CATEGORIES = {
    "internal_communication":    {"display_name": "Comunicacion Interna",          "sort_order": 1},
    "hr_administration":         {"display_name": "Administracion de RRHH",        "sort_order": 2},
    "talent_acquisition":        {"display_name": "Atraccion de Talento",          "sort_order": 3},
    "talent_development":        {"display_name": "Desarrollo de Talento",         "sort_order": 4},
    "culture_and_engagement":    {"display_name": "Cultura y Engagement",          "sort_order": 5},
    "compensation_and_benefits": {"display_name": "Compensaciones y Beneficios",   "sort_order": 6},
    "operations_and_workplace":  {"display_name": "Operaciones y Lugar de Trabajo","sort_order": 7},
}

# ──────────────────────────────────────────────
# Modules (37)
# ──────────────────────────────────────────────
MODULES = {
    # internal_communication (6)
    "chat":                     {"display_name": "Chat",                       "hr_category": "internal_communication", "status": "existing", "sort_order": 1},
    "internal_social_network":  {"display_name": "Red Social Interna",         "hr_category": "internal_communication", "status": "existing", "sort_order": 2},
    "magazine":                 {"display_name": "Revista Interna",            "hr_category": "internal_communication", "status": "existing", "sort_order": 3},
    "live_streaming":           {"display_name": "Streaming en Vivo",          "hr_category": "internal_communication", "status": "existing", "sort_order": 4},
    "knowledge_libraries":      {"display_name": "Biblioteca de Conocimiento", "hr_category": "internal_communication", "status": "existing", "sort_order": 5},
    "quick_links":              {"display_name": "Accesos Rapidos",            "hr_category": "internal_communication", "status": "existing", "sort_order": 6},
    # hr_administration (9)
    "digital_employee_file":    {"display_name": "Legajo Digital",             "hr_category": "hr_administration", "status": "existing", "sort_order": 7},
    "documents":                {"display_name": "Documentos",                 "hr_category": "hr_administration", "status": "existing", "sort_order": 8},
    "files":                    {"display_name": "Archivos",                   "hr_category": "hr_administration", "status": "existing", "sort_order": 9},
    "company_policies":         {"display_name": "Politicas de Empresa",       "hr_category": "hr_administration", "status": "existing", "sort_order": 10},
    "forms_and_workflows":      {"display_name": "Formularios y Flujos",       "hr_category": "hr_administration", "status": "existing", "sort_order": 11},
    "org_chart":                {"display_name": "Organigrama",                "hr_category": "hr_administration", "status": "existing", "sort_order": 12},
    "digital_access":           {"display_name": "Accesos Digitales",          "hr_category": "hr_administration", "status": "existing", "sort_order": 13},
    "security_and_privacy":     {"display_name": "Seguridad y Privacidad",     "hr_category": "hr_administration", "status": "existing", "sort_order": 14},
    "payroll":                  {"display_name": "Nomina / Payroll",           "hr_category": "hr_administration", "status": "missing",  "sort_order": 15},
    # talent_acquisition (4)
    "internal_job_postings":    {"display_name": "Vacantes Internas",          "hr_category": "talent_acquisition", "status": "existing", "sort_order": 16},
    "referral_program":         {"display_name": "Programa de Referidos",      "hr_category": "talent_acquisition", "status": "existing", "sort_order": 17},
    "onboarding":               {"display_name": "Onboarding",                 "hr_category": "talent_acquisition", "status": "existing", "sort_order": 18},
    "recruitment":              {"display_name": "Reclutamiento y Seleccion",  "hr_category": "talent_acquisition", "status": "roadmap",  "sort_order": 19},
    # talent_development (6)
    "performance_review":       {"display_name": "Evaluacion de Desempeno",    "hr_category": "talent_development", "status": "existing", "sort_order": 20},
    "goals_and_okrs":           {"display_name": "Objetivos y OKRs",           "hr_category": "talent_development", "status": "existing", "sort_order": 21},
    "development_plan":         {"display_name": "Plan de Desarrollo",         "hr_category": "talent_development", "status": "existing", "sort_order": 22},
    "learning":                 {"display_name": "Capacitacion / LMS",         "hr_category": "talent_development", "status": "existing", "sort_order": 23},
    "succession_planning":      {"display_name": "Planes de Sucesion",         "hr_category": "talent_development", "status": "missing",  "sort_order": 24},
    "prebuilt_courses":         {"display_name": "Cursos Listos",              "hr_category": "talent_development", "status": "missing",  "sort_order": 25},
    # culture_and_engagement (5)
    "people_experience":        {"display_name": "Encuestas de Clima",         "hr_category": "culture_and_engagement", "status": "existing", "sort_order": 26},
    "surveys":                  {"display_name": "Encuestas Generales",        "hr_category": "culture_and_engagement", "status": "existing", "sort_order": 27},
    "kudos":                    {"display_name": "Reconocimientos",            "hr_category": "culture_and_engagement", "status": "existing", "sort_order": 28},
    "birthdays_and_anniversaries": {"display_name": "Cumpleanos y Aniversarios","hr_category": "culture_and_engagement","status": "existing", "sort_order": 29},
    "events":                   {"display_name": "Eventos",                    "hr_category": "culture_and_engagement", "status": "existing", "sort_order": 30},
    # compensation_and_benefits (3)
    "perks_and_benefits":       {"display_name": "Beneficios Corporativos",    "hr_category": "compensation_and_benefits", "status": "existing", "sort_order": 31},
    "marketplace":              {"display_name": "Marketplace P2P",            "hr_category": "compensation_and_benefits", "status": "existing", "sort_order": 32},
    "benefits_administration":  {"display_name": "Administracion de Beneficios Flex", "hr_category": "compensation_and_benefits", "status": "missing",  "sort_order": 33},
    # operations_and_workplace (4)
    "time_off":                 {"display_name": "Vacaciones y Licencias",     "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 34},
    "time_tracking":            {"display_name": "Control Horario",            "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 35},
    "space_reservation":        {"display_name": "Reserva de Espacios",        "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 36},
    "service_management":       {"display_name": "Mesa de Servicios",          "hr_category": "operations_and_workplace", "status": "existing", "sort_order": 37},
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
# Pain Subtypes (31) — v3.1 redesigned
# All general (no module field), grouped by theme with discriminators
# ──────────────────────────────────────────────

PAIN_SUBTYPES = {
    # ── Theme: technology (5) ──
    "fragmented_tools":        {"display_name": "Herramientas fragmentadas",  "theme": "technology",          "module": None, "description": "Multiples herramientas desconectadas, la experiencia de loguearse en 5 sistemas"},
    "low_adoption":            {"display_name": "Baja adopcion",              "theme": "technology",          "module": None, "description": "La herramienta existe pero la gente no la usa, problema de change management"},
    "no_mobile_access":        {"display_name": "Sin acceso movil",           "theme": "technology",          "module": None, "description": "No pueden acceder desde dispositivos moviles"},
    "outdated_system":         {"display_name": "Sistema obsoleto",           "theme": "technology",          "module": None, "description": "Tecnologia legacy, vieja, sin soporte, deuda tecnologica"},
    "it_dependency":           {"display_name": "Dependencia de IT",          "theme": "technology",          "module": None, "description": "Cada cambio requiere intervencion de IT"},
    # ── Theme: processes (5) ──
    "manual_processes":        {"display_name": "Procesos manuales",          "theme": "processes",           "module": None, "description": "Trabajo en papel, Excel, sin digitalizar"},
    "process_bottlenecks":     {"display_name": "Cuellos de botella",         "theme": "processes",           "module": None, "description": "Flujos de aprobacion lentos, trabados, ineficientes"},
    "lack_of_standardization": {"display_name": "Sin estandarizacion",        "theme": "processes",           "module": None, "description": "Cada area o gerente lo hace distinto, sin proceso unificado"},
    "lack_of_self_service":    {"display_name": "Sin autogestion",            "theme": "processes",           "module": None, "description": "Empleados no pueden resolver tramites solos, dependen de HR"},
    "hr_operational_overload": {"display_name": "HR saturado en operacion",   "theme": "processes",           "module": None, "description": "Equipo HR saturado, sin tiempo para estrategia"},
    # ── Theme: communication (5) ──
    "unreachable_employees":   {"display_name": "Empleados inalcanzables",    "theme": "communication",       "module": None, "description": "Trabajadores sin email, sin PC, deskless, sin infraestructura digital"},
    "fragmented_channels":     {"display_name": "Canales fragmentados",       "theme": "communication",       "module": None, "description": "Demasiados canales oficiales, nadie sabe donde mirar"},
    "informal_channels":       {"display_name": "Canales informales",         "theme": "communication",       "module": None, "description": "Usan WhatsApp, Telegram u otras herramientas personales para trabajo"},
    "information_gaps":        {"display_name": "Informacion que no llega",   "theme": "communication",       "module": None, "description": "Brecha entre quienes tienen informacion y quienes no"},
    "multi_site_disconnect":   {"display_name": "Desconexion entre sedes",    "theme": "communication",       "module": None, "description": "Cada sede opera como silo aislado, distancia geografica"},
    # ── Theme: talent (5) ──
    "high_turnover":           {"display_name": "Alta rotacion",              "theme": "talent",              "module": None, "description": "Rotacion alta, especialmente en frontline"},
    "weak_employer_brand":     {"display_name": "Marca empleadora debil",     "theme": "talent",              "module": None, "description": "Dificil atraer talento, no se posicionan como empleador atractivo"},
    "skill_visibility_gap":    {"display_name": "Skills invisibles",          "theme": "talent",              "module": None, "description": "No saben que competencias tiene su gente"},
    "no_career_path":          {"display_name": "Sin plan de carrera",        "theme": "talent",              "module": None, "description": "Empleados no ven futuro ni crecimiento"},
    "ineffective_recruitment": {"display_name": "Reclutamiento ineficiente",  "theme": "talent",              "module": None, "description": "Proceso de seleccion lento, manual, desorganizado"},
    # ── Theme: engagement (4) ──
    "cultural_disconnection":  {"display_name": "Desconexion cultural",       "theme": "engagement",          "module": None, "description": "No sienten la cultura, falta pertenencia"},
    "no_recognition":          {"display_name": "Falta de reconocimiento",    "theme": "engagement",          "module": None, "description": "Sin mecanismo para reconocer logros ni celebrar"},
    "no_climate_measurement":  {"display_name": "Sin medicion de clima",      "theme": "engagement",          "module": None, "description": "No miden engagement, no saben como se sienten los empleados"},
    "remote_hybrid_challenges":{"display_name": "Desafios remoto/hibrido",    "theme": "engagement",          "module": None, "description": "Gestion de workforce distribuido, remoto o hibrido"},
    # ── Theme: data_and_analytics (3) ──
    "no_workforce_visibility": {"display_name": "Sin visibilidad de workforce","theme": "data_and_analytics", "module": None, "description": "No tienen datos consolidados sobre su gente"},
    "reporting_pain":          {"display_name": "Dolor de reportes",          "theme": "data_and_analytics",  "module": None, "description": "No pueden generar los reportes que necesitan, o es muy costoso"},
    "data_silos":              {"display_name": "Silos de datos",             "theme": "data_and_analytics",  "module": None, "description": "Datos repartidos en multiples sistemas sin vision unificada"},
    # ── Theme: compliance_and_scale (4) ──
    "compliance_risk":         {"display_name": "Riesgo regulatorio",         "theme": "compliance_and_scale","module": None, "description": "Riesgo de incumplir leyes laborales en un pais"},
    "multi_country_complexity":{"display_name": "Complejidad multi-pais",     "theme": "compliance_and_scale","module": None, "description": "Regulaciones, culturas y requisitos distintos entre paises"},
    "scaling_challenges":      {"display_name": "No escala",                  "theme": "compliance_and_scale","module": None, "description": "La plataforma o sistema actual no soporta el crecimiento"},
    "insecure_employee_data":  {"display_name": "Datos de empleados inseguros","theme": "compliance_and_scale","module": None, "description": "Preocupacion por seguridad de datos de empleados en sistemas actuales"},
}

# ──────────────────────────────────────────────
# Product Gap Subtypes (5) — NEW in v3.1
# ──────────────────────────────────────────────
PRODUCT_GAP_SUBTYPES = {
    "missing_capability":     {"display_name": "Funcionalidad inexistente",   "description": "El modulo o feature no existe en absoluto"},
    "insufficient_depth":     {"display_name": "Funcionalidad insuficiente",  "description": "Existe pero es demasiado basico, le faltan capacidades"},
    "missing_integration":    {"display_name": "Integracion faltante",        "description": "Necesitan conectar con un sistema externo no soportado"},
    "ux_limitation":          {"display_name": "Limitacion de UX",            "description": "La funcionalidad existe pero es dificil de usar"},
    "scalability_limitation": {"display_name": "Limitacion de escala",        "description": "No funciona al volumen o complejidad que necesitan"},
}

# ──────────────────────────────────────────────
# Deal Friction Subtypes (14)
# ──────────────────────────────────────────────
DEAL_FRICTION_SUBTYPES = {
    "budget":               {"display_name": "Restriccion presupuestaria",  "description": "No hay presupuesto o es insuficiente"},
    "roi_justification":    {"display_name": "Justificacion de ROI",        "description": "Hay presupuesto pero necesitan armar el business case"},
    "timing":               {"display_name": "Timing desalineado",          "description": "No es el momento por razones de calendario"},
    "decision_maker":       {"display_name": "Falta decisor",               "description": "El decisor no esta involucrado"},
    "internal_alignment":   {"display_name": "Desalineacion interna",       "description": "Los stakeholders no se ponen de acuerdo"},
    "legal":                {"display_name": "Revision legal/compliance",   "description": "Necesitan pasar por legal, DPA, procurement"},
    "technical":            {"display_name": "Complejidad tecnica",         "description": "Requisitos de SSO, APIs, infraestructura, IT"},
    "change_management":    {"display_name": "Resistencia al cambio",       "description": "Preocupacion por adopcion o resistencia de usuarios"},
    "champion_risk":        {"display_name": "Champion en riesgo",          "description": "El sponsor interno es debil, se va o no tiene influencia"},
    "incumbent_lock_in":    {"display_name": "Contrato existente",          "description": "Atados a contrato vigente con otro proveedor"},
    "scope_mismatch":       {"display_name": "Alcance insuficiente",        "description": "La solucion no cubre todos los requerimientos como paquete"},
    "security_review":      {"display_name": "Revision de seguridad",       "description": "InfoSec debe validar antes de aprobar"},
    "regional_requirements":{"display_name": "Requisitos regionales",       "description": "Necesidades de pais no cubiertas"},
    "competing_priorities": {"display_name": "Prioridades competidoras",    "description": "Otros proyectos compiten por budget o atencion"},
}

# ──────────────────────────────────────────────
# FAQ Subtypes (18)
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
    "contract_terms":     {"display_name": "Terminos contractuales",  "description": "Duracion, flexibilidad, clausulas de salida"},
    "references":         {"display_name": "Referencias y casos",     "description": "Clientes de referencia, casos de exito, testimonios"},
    "data_ownership":     {"display_name": "Propiedad de datos",      "description": "Quien es dueno de los datos, portabilidad, exportacion"},
}

# ──────────────────────────────────────────────
# Competitive Relationships (6)
# ──────────────────────────────────────────────
COMPETITIVE_RELATIONSHIPS = {
    "currently_using": {"display_name": "Usa actualmente",    "description": "El prospecto usa este competidor hoy"},
    "evaluating":      {"display_name": "Evaluando / Comparando", "description": "Proceso activo de evaluacion o comparacion"},
    "migrating_from":  {"display_name": "Migrando desde",    "description": "Estan en proceso de dejar este competidor"},
    "previously_used": {"display_name": "Uso antes",         "description": "Lo usaron en el pasado y ya dejaron"},
    "mentioned":       {"display_name": "Mencionado",        "description": "Mencion sin senal fuerte de uso ni evaluacion"},
    "rejected":        {"display_name": "Descartado",        "description": "Lo evaluaron y decidieron no usarlo"},
}

# ──────────────────────────────────────────────
# Competitor Categories (7) — NEW in v3.1
# ──────────────────────────────────────────────
COMPETITOR_CATEGORIES = {
    "hris_payroll":          {"display_name": "HRIS con nomina",                   "description": "Plataformas HR con modulo de nomina"},
    "internal_comms":        {"display_name": "Comunicacion interna",              "description": "Intranets, apps de empleados, redes sociales internas"},
    "talent_management":     {"display_name": "Performance, engagement, learning", "description": "Gestion de talento, evaluaciones, engagement, LMS"},
    "general_collaboration": {"display_name": "Colaboracion general",              "description": "Herramientas de productividad y colaboracion de uso general"},
    "erp_hcm":              {"display_name": "Suites enterprise (ERP/HCM)",        "description": "Suites empresariales de gran escala con HCM"},
    "deskless_operations":  {"display_name": "Soluciones deskless",                "description": "Plataformas para trabajadores sin escritorio"},
    "point_solution":       {"display_name": "Soluciones puntuales",               "description": "Soluciones especializadas en nicho especifico"},
}

# ──────────────────────────────────────────────
# Competitors (85) — restructured with category
# ──────────────────────────────────────────────
COMPETITORS = {
    # hris_payroll (26)
    "Buk":              {"region": "latam",         "category": "hris_payroll"},
    "Factorial":        {"region": "latam",         "category": "hris_payroll"},
    "Pandape":          {"region": "latam",         "category": "hris_payroll"},
    "Visma":            {"region": "latam",         "category": "hris_payroll"},
    "Sesame HR":        {"region": "global",        "category": "hris_payroll"},
    "Worky":            {"region": "latam",         "category": "hris_payroll"},
    "Tress":            {"region": "latam",         "category": "hris_payroll"},
    "Fortia":           {"region": "latam",         "category": "hris_payroll"},
    "Novasoft":         {"region": "latam",         "category": "hris_payroll"},
    "Defontana":        {"region": "latam",         "category": "hris_payroll"},
    "Digitalware":      {"region": "latam",         "category": "hris_payroll"},
    "Heinsohn":         {"region": "latam",         "category": "hris_payroll"},
    "Talento Zeus":     {"region": "latam",         "category": "hris_payroll"},
    "Talento Cloud":    {"region": "latam",         "category": "hris_payroll"},
    "Solides":          {"region": "latam",         "category": "hris_payroll"},
    "Convenia":         {"region": "latam",         "category": "hris_payroll"},
    "HiBob":            {"region": "global",        "category": "hris_payroll"},
    "Bizneo":           {"region": "emea",          "category": "hris_payroll"},
    "Personio":         {"region": "emea",          "category": "hris_payroll"},
    "Sage":             {"region": "emea",          "category": "hris_payroll"},
    "Zucchetti":        {"region": "emea",          "category": "hris_payroll"},
    "BambooHR":         {"region": "north_america", "category": "hris_payroll"},
    "Paylocity":        {"region": "north_america", "category": "hris_payroll"},
    "Rippling":         {"region": "north_america", "category": "hris_payroll"},
    "Gupy":             {"region": "latam",         "category": "hris_payroll"},
    "Deer":             {"region": "latam",         "category": "hris_payroll"},
    # internal_comms (24)
    "Workplace (Meta)":        {"region": "global",        "category": "internal_comms"},
    "Microsoft Viva Engage":   {"region": "global",        "category": "internal_comms"},
    "Workvivo":                {"region": "global",        "category": "internal_comms"},
    "Indigital":               {"region": "latam",         "category": "internal_comms"},
    "Dialog":                  {"region": "latam",         "category": "internal_comms"},
    "Connecto":                {"region": "latam",         "category": "internal_comms"},
    "Beehome":                 {"region": "latam",         "category": "internal_comms"},
    "Comunitive":              {"region": "latam",         "category": "internal_comms"},
    "Hywork":                  {"region": "latam",         "category": "internal_comms"},
    "Beekeeper":               {"region": "emea",          "category": "internal_comms"},
    "Flip":                    {"region": "emea",          "category": "internal_comms"},
    "Staffbase":               {"region": "emea",          "category": "internal_comms"},
    "Blink":                   {"region": "emea",          "category": "internal_comms"},
    "Sociabble":               {"region": "emea",          "category": "internal_comms"},
    "Speakapp":                {"region": "emea",          "category": "internal_comms"},
    "Haiilo":                  {"region": "north_america", "category": "internal_comms"},
    "Simpplr":                 {"region": "north_america", "category": "internal_comms"},
    "Firstup":                 {"region": "north_america", "category": "internal_comms"},
    "Poppulo":                 {"region": "north_america", "category": "internal_comms"},
    "Interact":                {"region": "north_america", "category": "internal_comms"},
    "Jostle":                  {"region": "north_america", "category": "internal_comms"},
    "Unily":                   {"region": "north_america", "category": "internal_comms"},
    "LumApps":                 {"region": "north_america", "category": "internal_comms"},
    "Igloo Software":          {"region": "north_america", "category": "internal_comms"},
    # talent_management (13)
    "Rankmi":          {"region": "latam",         "category": "talent_management"},
    "GoIntegro":       {"region": "latam",         "category": "talent_management"},
    "Lapzo":           {"region": "latam",         "category": "talent_management"},
    "Crehana":         {"region": "latam",         "category": "talent_management"},
    "UBits":           {"region": "latam",         "category": "talent_management"},
    "Betterfly":       {"region": "latam",         "category": "talent_management"},
    "Culture Amp":     {"region": "north_america", "category": "talent_management"},
    "Lattice":         {"region": "north_america", "category": "talent_management"},
    "15Five":          {"region": "north_america", "category": "talent_management"},
    "WorkTango":       {"region": "north_america", "category": "talent_management"},
    "Glint":           {"region": "north_america", "category": "talent_management"},
    "Qualtrics":       {"region": "north_america", "category": "talent_management"},
    "PeopleForce":     {"region": "emea",          "category": "talent_management"},
    # general_collaboration (5)
    "Microsoft Teams":   {"region": "global", "category": "general_collaboration"},
    "Slack":             {"region": "global", "category": "general_collaboration"},
    "Google Workspace":  {"region": "global", "category": "general_collaboration"},
    "SharePoint":        {"region": "global", "category": "general_collaboration"},
    "Lark":              {"region": "apac",   "category": "general_collaboration"},
    # erp_hcm (7)
    "SAP SuccessFactors": {"region": "global",        "category": "erp_hcm"},
    "Workday":            {"region": "global",        "category": "erp_hcm"},
    "Meta4 (Cegid)":      {"region": "latam",         "category": "erp_hcm"},
    "Totvs":              {"region": "latam",         "category": "erp_hcm"},
    "ADP":                {"region": "global",        "category": "erp_hcm"},
    "UKG":                {"region": "north_america", "category": "erp_hcm"},
    "Dayforce":           {"region": "north_america", "category": "erp_hcm"},
    # deskless_operations (3)
    "Connecteam":  {"region": "global",        "category": "deskless_operations"},
    "Yoobic":      {"region": "emea",          "category": "deskless_operations"},
    "Workjam":     {"region": "north_america", "category": "deskless_operations"},
    # point_solution (6)
    "Esigtek":    {"region": "latam",         "category": "point_solution"},
    "Alest":      {"region": "latam",         "category": "point_solution"},
    "Workable":   {"region": "north_america", "category": "point_solution"},
    "Assembly":   {"region": "north_america", "category": "point_solution"},
    "Simplrr":    {"region": "apac",          "category": "point_solution"},
    "Weconnect":  {"region": "apac",          "category": "point_solution"},
}

# ──────────────────────────────────────────────
# Feature Names (seed list for product_gap) — 52
# ──────────────────────────────────────────────
SEED_FEATURE_NAMES = {
    # Payroll / Nomina
    "payroll_integration":      {"display_name": "Integracion de nomina",          "suggested_module": "payroll"},
    "multi_entity_payroll":     {"display_name": "Nomina multi-razon social",      "suggested_module": "payroll"},
    "payslip_distribution":     {"display_name": "Distribucion de recibos de sueldo", "suggested_module": "documents"},
    # Recruitment (consolidated)
    "ats_tracking":             {"display_name": "Tracking de candidatos (ATS)",   "suggested_module": "recruitment"},
    "ai_candidate_matching":    {"display_name": "Seleccion con IA",              "suggested_module": "recruitment"},
    "recruitment_workflows":    {"display_name": "Flujos de requisicion y seleccion", "suggested_module": "recruitment"},
    "talent_marketplace":       {"display_name": "Marketplace interno de talento", "suggested_module": "internal_job_postings"},
    # Talent Development
    "succession_planning_tool": {"display_name": "Herramienta de planes de sucesion", "suggested_module": "succession_planning"},
    "prebuilt_course_catalog":  {"display_name": "Catalogo de cursos listos",      "suggested_module": "prebuilt_courses"},
    "nine_box_grid":            {"display_name": "Nine box grid",                  "suggested_module": "performance_review"},
    "scorm_support":            {"display_name": "Soporte SCORM",                  "suggested_module": "learning"},
    "skill_matrix":             {"display_name": "Matriz de competencias",         "suggested_module": "performance_review"},
    "career_path_builder":      {"display_name": "Constructor de planes de carrera", "suggested_module": "development_plan"},
    "competencies_module":      {"display_name": "Modulo de competencias",         "suggested_module": "performance_review"},
    # Clima y Engagement
    "pulse_surveys":            {"display_name": "Encuestas de pulso",             "suggested_module": "people_experience"},
    "enps_tracking":            {"display_name": "Medicion de eNPS",               "suggested_module": "people_experience"},
    "exit_interviews":          {"display_name": "Entrevistas de salida",          "suggested_module": "people_experience"},
    "anonymous_feedback":       {"display_name": "Feedback anonimo",               "suggested_module": "people_experience"},
    "employee_wellness":        {"display_name": "Bienestar del empleado",         "suggested_module": "people_experience"},
    "gamification":             {"display_name": "Gamificacion",                   "suggested_module": "kudos"},
    # Compensation & Benefits
    "flex_benefits":            {"display_name": "Beneficios flexibles / cafeteria", "suggested_module": "benefits_administration"},
    "compensation_management":  {"display_name": "Gestion de compensaciones",      "suggested_module": None},
    "expense_management":       {"display_name": "Gestion de gastos",              "suggested_module": None},
    # Operations & Workplace
    "shift_scheduling":         {"display_name": "Planificacion de turnos",        "suggested_module": "time_tracking"},
    "geofencing":               {"display_name": "Geofencing",                     "suggested_module": "time_tracking"},
    "biometric_integration":    {"display_name": "Integracion con relojes biometricos", "suggested_module": "time_tracking"},
    "absence_calendar":         {"display_name": "Calendario de ausencias del equipo", "suggested_module": "time_off"},
    "offboarding_workflows":    {"display_name": "Flujos de offboarding",          "suggested_module": "onboarding"},
    # Communication
    "whatsapp_integration":     {"display_name": "Integracion WhatsApp",           "suggested_module": "chat"},
    "ai_chatbot":               {"display_name": "Chatbot con IA",                 "suggested_module": "chat"},
    "video_conferencing":       {"display_name": "Videoconferencia nativa",        "suggested_module": "live_streaming"},
    "push_notifications":       {"display_name": "Notificaciones push avanzadas",  "suggested_module": None},
    "multi_language_content":   {"display_name": "Contenido multi-idioma",         "suggested_module": None},
    "segmented_communications": {"display_name": "Comunicaciones segmentadas por grupo", "suggested_module": "internal_social_network"},
    # Administration / Platform
    "hris_core":                {"display_name": "Core HRIS",                      "suggested_module": "digital_employee_file"},
    "digital_signature":        {"display_name": "Firma digital / electronica",    "suggested_module": "documents"},
    "org_chart_management":     {"display_name": "Gestion visual de organigrama",  "suggested_module": "org_chart"},
    "role_based_permissions":   {"display_name": "Permisos granulares por rol",    "suggested_module": "security_and_privacy"},
    "multi_entity_support":     {"display_name": "Soporte multi-razon social",     "suggested_module": None},
    "contractor_portal":        {"display_name": "Portal para contratistas",       "suggested_module": None},
    "modular_contracting":      {"display_name": "Contratacion modular",           "suggested_module": None},
    "custom_branding":          {"display_name": "Branding personalizado",         "suggested_module": None},
    "employee_directory":       {"display_name": "Directorio de empleados",        "suggested_module": "org_chart"},
    # Analytics & Data
    "advanced_analytics":       {"display_name": "Analytics avanzado",             "suggested_module": None},
    "bi_dashboard":             {"display_name": "Dashboard BI",                   "suggested_module": None},
    "predictive_analytics":     {"display_name": "Analytics predictivo",           "suggested_module": None},
    "custom_reports_builder":   {"display_name": "Constructor de reportes custom", "suggested_module": None},
    "labor_cost_analytics":     {"display_name": "Analytics de costo laboral",     "suggested_module": None},
    "workforce_planning":       {"display_name": "Planificacion de workforce",     "suggested_module": None},
    # Integrations
    "sso_integration":          {"display_name": "Integracion SSO",                "suggested_module": "security_and_privacy"},
    "api_access":               {"display_name": "Acceso API",                     "suggested_module": "digital_access"},
    "sap_integration":          {"display_name": "Integracion SAP",                "suggested_module": None},
    "workday_integration":      {"display_name": "Integracion Workday",            "suggested_module": None},
    "slack_teams_integration":  {"display_name": "Integracion Slack/Teams",        "suggested_module": "chat"},
    "offline_mode":             {"display_name": "Modo offline",                   "suggested_module": None},
}

# ──────────────────────────────────────────────
# Module Aliases (for LLM normalization)
# ──────────────────────────────────────────────
MODULE_ALIASES = {
    # chat
    "chat interno": "chat", "mensajeria interna": "chat", "mensajes directos": "chat",
    "chat de empleados": "chat", "centro de mensajes": "chat",
    "mensagens": "chat", "im": "chat", "dm": "chat",
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
    # recruitment (consolidated: ats + ai_recruiter → recruitment)
    "ats": "recruitment", "tracking de candidatos": "recruitment", "applicant tracking": "recruitment",
    "reclutador con ia": "recruitment", "reclutamiento ia": "recruitment",
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
    "encuestas de clima": "people_experience", "clima organizacional": "people_experience",
    "enps": "people_experience", "employee experience": "people_experience",
    # surveys
    "encuestas": "surveys", "encuestas generales": "surveys",
    # kudos
    "reconocimientos": "kudos", "kudos": "kudos", "programa de reconocimiento": "kudos",
    # birthdays_and_anniversaries
    "cumpleanos y aniversarios": "birthdays_and_anniversaries",
    "cumpleanos": "birthdays_and_anniversaries",
    # events
    "eventos": "events", "gestion de eventos": "events",
    # perks_and_benefits
    "beneficios corporativos": "perks_and_benefits", "beneficios": "perks_and_benefits",
    "perks": "perks_and_benefits",
    # marketplace
    "marketplace": "marketplace", "marketplace p2p": "marketplace",
    # benefits_administration (redirected from benefits_platform)
    "plataforma de beneficios": "benefits_administration",
    "beneficios flexibles": "benefits_administration",
    "administracion de beneficios": "benefits_administration",
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

def get_valid_product_gap_codes() -> set[str]:
    return set(PRODUCT_GAP_SUBTYPES.keys())

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
