-- Restore pre-existing behavior: caregivers who already sign in keep Timesheets.
UPDATE public.family_members m SET timesheets_enabled = true
WHERE m.role = 'caregiver' AND m.timesheets_enabled = false
  AND EXISTS (SELECT 1 FROM public.family_users fu WHERE fu.family_member_id = m.id AND fu.family_id = m.family_id);

-- Carry the saved default babysitter over to the caregiver-record column.
UPDATE public.families f SET default_babysitter_member_id = fu.family_member_id
FROM public.family_users fu JOIN public.family_members m ON m.id = fu.family_member_id
WHERE f.default_babysitter_member_id IS NULL
  AND f.default_babysitter_family_user_id = fu.id
  AND fu.family_id = f.id AND m.family_id = f.id
  AND m.role = 'caregiver' AND m.active AND m.removed_at IS NULL;