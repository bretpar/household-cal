ALTER TABLE public.babysitter_shifts
  ADD COLUMN assignee_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS babysitter_shifts_assignee_member_idx ON public.babysitter_shifts(assignee_member_id);