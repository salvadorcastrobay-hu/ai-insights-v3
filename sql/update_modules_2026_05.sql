-- =================================================================
-- Module taxonomy update — 2026-05
-- =================================================================
-- Cambios:
--   1. Crea categoría 'platform' para Roles, Integrations, Insights
--   2. Renombra display names de 17 módulos para que matcheen la
--      nomenclatura oficial de Humand (EN/ES)
--   3. Cambia ats, payroll, ai_recruiter de 'missing' a 'roadmap'
--   4. Inserta 3 nuevos módulos: roles_permissions, integrations, insights
--
-- Seguridad:
--   - Todo corre dentro de una transacción (BEGIN/COMMIT)
--   - SOLO usa INSERT y UPDATE — NO hay DELETE, DROP ni TRUNCATE
--   - INSERTs usan ON CONFLICT DO NOTHING (re-ejecutable sin efecto)
--   - Verificación final con SELECT antes de COMMIT
--
-- Aplica al instante a todos los insights existentes vía
-- v_insights_dashboard (los rows de transcript_insights no se tocan).
-- =================================================================

BEGIN;

-- ─── 1. Nueva categoría 'platform' ──────────────────────────────
INSERT INTO tax_hr_categories (code, display_name, sort_order)
VALUES ('platform', 'Plataforma', 8)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Renames de display names ────────────────────────────────
UPDATE tax_modules SET display_name = 'Noticias'                              WHERE code = 'magazine';
UPDATE tax_modules SET display_name = 'Biblioteca de Recursos'                WHERE code = 'knowledge_libraries';
UPDATE tax_modules SET display_name = 'Beneficios'                            WHERE code = 'perks_and_benefits';
UPDATE tax_modules SET display_name = 'Vacaciones y Permisos'                 WHERE code = 'time_off';
UPDATE tax_modules SET display_name = 'Expediente digital del colaborador'    WHERE code = 'digital_employee_file';
UPDATE tax_modules SET display_name = 'Objetivos y Resultados Clave'          WHERE code = 'goals_and_okrs';
UPDATE tax_modules SET display_name = 'Aprendizaje'                           WHERE code = 'learning';
UPDATE tax_modules SET display_name = 'Plan de carrera'                       WHERE code = 'development_plan';
UPDATE tax_modules SET display_name = 'Busquedas internas'                    WHERE code = 'internal_job_postings';
UPDATE tax_modules SET display_name = 'Control de Asistencia'                 WHERE code = 'time_tracking';
UPDATE tax_modules SET display_name = 'Formularios, tramites y aprobaciones'  WHERE code = 'forms_and_workflows';
UPDATE tax_modules SET display_name = 'Gestion de Servicios'                  WHERE code = 'service_management';
UPDATE tax_modules SET display_name = 'Marketplace'                           WHERE code = 'marketplace';
UPDATE tax_modules SET display_name = 'Acceso con ID'                         WHERE code = 'digital_access';
UPDATE tax_modules SET display_name = 'People Experience'                     WHERE code = 'people_experience';
UPDATE tax_modules SET display_name = 'Politicas'                             WHERE code = 'company_policies';
UPDATE tax_modules SET display_name = 'Live Streaming'                        WHERE code = 'live_streaming';

-- ─── 3. Status changes a 'roadmap' ──────────────────────────────
UPDATE tax_modules SET status = 'roadmap' WHERE code = 'ats';
UPDATE tax_modules SET status = 'roadmap' WHERE code = 'payroll';
UPDATE tax_modules SET status = 'roadmap' WHERE code = 'ai_recruiter';

-- ─── 4. Nuevos módulos en categoría 'platform' ──────────────────
INSERT INTO tax_modules (code, display_name, hr_category, status, sort_order)
VALUES
    ('roles_permissions', 'Roles & Permisos', 'platform', 'existing', 40),
    ('integrations',      'Integraciones',    'platform', 'existing', 41),
    ('insights',          'Insights',         'platform', 'existing', 42)
ON CONFLICT (code) DO NOTHING;

-- ─── Verificación pre-commit ────────────────────────────────────
-- Conteo por status, deberíamos ver: 35 existing / 4 missing / 4 roadmap
DO $$
DECLARE
    cnt_existing INTEGER;
    cnt_missing  INTEGER;
    cnt_roadmap  INTEGER;
    cnt_total    INTEGER;
BEGIN
    SELECT COUNT(*) INTO cnt_existing FROM tax_modules WHERE status = 'existing';
    SELECT COUNT(*) INTO cnt_missing  FROM tax_modules WHERE status = 'missing';
    SELECT COUNT(*) INTO cnt_roadmap  FROM tax_modules WHERE status = 'roadmap';
    SELECT COUNT(*) INTO cnt_total    FROM tax_modules;

    RAISE NOTICE 'tax_modules counts after migration:';
    RAISE NOTICE '  existing : %', cnt_existing;
    RAISE NOTICE '  missing  : %', cnt_missing;
    RAISE NOTICE '  roadmap  : %', cnt_roadmap;
    RAISE NOTICE '  total    : %', cnt_total;

    IF cnt_total < 40 THEN
        RAISE EXCEPTION 'expected at least 40 modules, got %', cnt_total;
    END IF;
END $$;

COMMIT;

-- ─── Confirmación final (read-only) ─────────────────────────────
SELECT status, COUNT(*) AS n
FROM tax_modules
GROUP BY status
ORDER BY status;
