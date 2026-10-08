DROP POLICY IF EXISTS bs_select ON public.babysitter_shifts;
CREATE POLICY bs_select ON public.babysitter_shifts FOR SELECT TO authenticated
USING (
  public.can_edit_family(family_id)
  OR family_user_id = public.babysitter_membership(family_id)
  OR (
    assignment = 'caregiver'
    AND assignee_member_id IS NOT NULL
    AND public.babysitter_membership(family_id) IS NOT NULL
    AND assignee_member_id = public.my_caregiver_member_id(family_id)
  )
);