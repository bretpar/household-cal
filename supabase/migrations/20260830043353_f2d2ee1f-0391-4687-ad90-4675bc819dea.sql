ALTER TABLE public.email_schedule_recipients
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.email_schedule_recipients r
   SET user_id = fu.user_id
  FROM public.family_users fu
  JOIN auth.users u ON u.id = fu.user_id
 WHERE r.user_id IS NULL
   AND fu.family_id = r.family_id
   AND lower(u.email) = lower(r.email);

UPDATE public.email_schedule_recipients
   SET weekdays = '{}'
 WHERE weekdays IS NULL;

CREATE INDEX IF NOT EXISTS email_schedule_recipients_user_id_idx
  ON public.email_schedule_recipients (user_id);