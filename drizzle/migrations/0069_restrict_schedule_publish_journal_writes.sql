DROP POLICY IF EXISTS "Editors create publish ops" ON public.babysitter_schedule_publish_ops;
DROP POLICY IF EXISTS "Editors update publish ops" ON public.babysitter_schedule_publish_ops;
REVOKE INSERT, UPDATE ON public.babysitter_schedule_publish_ops FROM authenticated;