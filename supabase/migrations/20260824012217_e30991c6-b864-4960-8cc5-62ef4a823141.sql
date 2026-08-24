CREATE OR REPLACE FUNCTION public.protect_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  owner_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN RETURN OLD; END IF;
    -- allow cascades: household or account is going away entirely
    IF NOT EXISTS (SELECT 1 FROM public.families WHERE id = OLD.family_id) THEN
      RETURN OLD;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
      RETURN OLD;
    END IF;
    SELECT count(*) INTO owner_count FROM public.family_users
      WHERE family_id = OLD.family_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'a household must keep at least one owner';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    SELECT count(*) INTO owner_count FROM public.family_users
      WHERE family_id = OLD.family_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'a household must keep at least one owner';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;