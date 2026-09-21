ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS display_icon text;

ALTER TABLE public.calendar_sources
  DROP CONSTRAINT IF EXISTS calendar_sources_display_icon_check;

ALTER TABLE public.calendar_sources
  ADD CONSTRAINT calendar_sources_display_icon_check
  CHECK (
    display_icon IS NULL
    OR display_icon IN (
      'work','medical','school','sports','car','home',
      'sitter','travel','birthday','family','star','calendar'
    )
  );

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY family_id ORDER BY sort_order, created_at, id) - 1 AS rn
  FROM public.calendar_sources
  WHERE color IS NULL
)
UPDATE public.calendar_sources AS cs
SET color = (ARRAY['sky','sage','lilac','amber','teal','rose','coral','sand'])[(ranked.rn % 8) + 1]
FROM ranked
WHERE ranked.id = cs.id;