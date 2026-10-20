CREATE TABLE public.auth_lookup_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_lookup_attempts_bucket_time ON public.auth_lookup_attempts (bucket, created_at);
GRANT ALL ON public.auth_lookup_attempts TO service_role;
ALTER TABLE public.auth_lookup_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_auth_lookup(_bucket text, _max int, _window_seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_bucket));
  DELETE FROM public.auth_lookup_attempts WHERE created_at < now() - interval '1 day';
  SELECT count(*) INTO n FROM public.auth_lookup_attempts
    WHERE bucket = _bucket AND created_at > now() - make_interval(secs => _window_seconds);
  IF n >= _max THEN RETURN false; END IF;
  INSERT INTO public.auth_lookup_attempts (bucket) VALUES (_bucket);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.consume_auth_lookup(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_lookup(text, int, int) TO service_role;