-- Daily Log — optional demo data
--
-- Loads the sample team and projects from the design handoff. Run after
-- schema.sql only if you want demo data; skip it for a real company.
-- Safe to re-run.

-- created_at is staggered so lists keep this order.
INSERT INTO employees (name, email, created_at)
SELECT name, lower(name) || '@studio.ai', now() + n * interval '1 millisecond'
FROM unnest(ARRAY[
  'Vipul', 'Aniket', 'Gauri', 'Isha', 'Kishan', 'Samiksha', 'Chirag',
  'Ninad', 'Riya', 'Ravi', 'Leena', 'Swapnil', 'Ajay', 'Kritik',
  'Tirth', 'Aditya', 'Jayesh', 'Tanvi', 'Jinal', 'Vedashree', 'Darsh'
]) WITH ORDINALITY AS t (name, n)
WHERE NOT EXISTS (
  SELECT 1 FROM employees e WHERE e.email = lower(t.name) || '@studio.ai' AND e.removed_at IS NULL
);

INSERT INTO projects (name, archived, created_at)
VALUES
  ('18 days',           FALSE, now() - interval '4 minutes'),
  ('DVA',               FALSE, now() - interval '3 minutes'),
  ('Yash – Sadma',      FALSE, now() - interval '2 minutes'),
  ('Studio tests 2025', TRUE,  now() - interval '1 minute')
ON CONFLICT DO NOTHING;

-- EP 01 – EP 07 for the active projects, EP 01 – EP 02 for the archived one.
INSERT INTO episodes (project_id, position, name)
SELECT p.id, n - 1, 'EP ' || lpad(n::text, 2, '0')
FROM projects p
CROSS JOIN generate_series(1, 7) AS n
WHERE p.name IN ('18 days', 'DVA', 'Yash – Sadma')
   OR (p.name = 'Studio tests 2025' AND n <= 2)
ON CONFLICT DO NOTHING;

INSERT INTO holidays (holiday_date)
VALUES ('2026-10-02'), ('2026-10-20')
ON CONFLICT DO NOTHING;
