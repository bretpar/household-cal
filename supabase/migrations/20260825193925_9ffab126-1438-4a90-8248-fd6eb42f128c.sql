CREATE TABLE public.event_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'sky',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX event_categories_family_name_key
  ON public.event_categories (family_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_categories TO authenticated;
GRANT ALL ON public.event_categories TO service_role;

ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_categories_select ON public.event_categories
  FOR SELECT TO authenticated USING (public.has_family_access(family_id));

CREATE POLICY event_categories_write_editors ON public.event_categories
  FOR ALL TO authenticated
  USING (public.can_edit_family(family_id))
  WITH CHECK (public.can_edit_family(family_id));

CREATE TRIGGER event_categories_updated_at
  BEFORE UPDATE ON public.event_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.assert_max_seven_event_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category_count int;
BEGIN
  SELECT count(*) INTO category_count
    FROM public.event_categories
   WHERE family_id = NEW.family_id
     AND id <> NEW.id;
  IF category_count >= 7 THEN
    RAISE EXCEPTION 'a household can have at most 7 event categories';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER event_categories_max_seven
  BEFORE INSERT OR UPDATE ON public.event_categories
  FOR EACH ROW EXECUTE FUNCTION public.assert_max_seven_event_categories();

ALTER TABLE public.events
  ADD COLUMN category_id uuid REFERENCES public.event_categories(id) ON DELETE SET NULL;

CREATE INDEX events_category_id_idx ON public.events (category_id);