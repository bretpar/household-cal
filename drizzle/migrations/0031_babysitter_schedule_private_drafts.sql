CREATE TABLE public.babysitter_schedule_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 content jsonb NOT NULL DEFAULT '{"shifts":[]}'::jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (family_id, month)
);
GRANT SELECT, INSERT, UPDATE ON public.babysitter_schedule_drafts TO authenticated;
GRANT ALL ON public.babysitter_schedule_drafts TO service_role;
ALTER TABLE public.babysitter_schedule_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read private schedule drafts" ON public.babysitter_schedule_drafts FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY "Owners create private schedule drafts" ON public.babysitter_schedule_drafts FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY "Owners edit private schedule drafts" ON public.babysitter_schedule_drafts FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));
CREATE TABLE public.babysitter_schedule_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
 content jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.babysitter_schedule_templates TO authenticated;
GRANT ALL ON public.babysitter_schedule_templates TO service_role;
ALTER TABLE public.babysitter_schedule_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read schedule templates" ON public.babysitter_schedule_templates FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY "Owners create schedule templates" ON public.babysitter_schedule_templates FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY "Owners edit schedule templates" ON public.babysitter_schedule_templates FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));
CREATE FUNCTION public.guard_private_schedule_revision() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.revision <> 1 THEN RAISE EXCEPTION 'New schedules must start at revision 1'; END IF;
 ELSE
  IF NEW.family_id <> OLD.family_id OR NEW.id <> OLD.id THEN RAISE EXCEPTION 'Schedule identity cannot change'; END IF;
  IF TG_TABLE_NAME = 'babysitter_schedule_drafts' AND (to_jsonb(NEW)->>'month') IS DISTINCT FROM (to_jsonb(OLD)->>'month') THEN RAISE EXCEPTION 'Draft month cannot change'; END IF;
  IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Schedule revision conflict'; END IF;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_schedule_draft_revision BEFORE INSERT OR UPDATE ON public.babysitter_schedule_drafts FOR EACH ROW EXECUTE FUNCTION public.guard_private_schedule_revision();
CREATE TRIGGER guard_schedule_template_revision BEFORE INSERT OR UPDATE ON public.babysitter_schedule_templates FOR EACH ROW EXECUTE FUNCTION public.guard_private_schedule_revision();