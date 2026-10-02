ALTER TABLE public.babysitter_shifts DROP CONSTRAINT babysitter_shifts_assignment_check;
ALTER TABLE public.babysitter_shifts ADD CONSTRAINT babysitter_shifts_assignment_check CHECK (
  ((assignment = 'caregiver') AND (assignee_member_id IS NOT NULL) AND (assignee_name IS NULL))
  OR ((assignment = 'other') AND (family_user_id IS NULL) AND (length(btrim(COALESCE(assignee_name, ''))) BETWEEN 1 AND 120))
  OR ((assignment = 'none') AND (family_user_id IS NULL) AND (assignee_name IS NULL))
);