DO $r$
DECLARE d text; a text := $a$  -- Claim exactly once under concurrent requests.$a$;
BEGIN
  SELECT pg_get_functiondef('public.apply_schedule_publish_op(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,uuid,text)'::regprocedure) INTO d;
  IF strpos(d, a) = 0 THEN RAISE EXCEPTION 'Unexpected publish RPC claim anchor'; END IF;
  d := replace(d, a, $n$  -- Historical dates are read-only at the authoritative boundary: compare the
  -- original occurrence and target dates against the household's current date.
  IF _op->>'kind' IN ('create','update','exclude') AND EXISTS (
    SELECT 1 FROM public.families f,
      LATERAL (VALUES (_op->>'occurrenceDate'), (_reviewed->'original'->>'date'),
        (CASE WHEN _op->>'kind' <> 'exclude' THEN _shift->>'date' END)) v(dt)
    WHERE f.id = _family AND nullif(v.dt,'') IS NOT NULL
      AND v.dt::date < (now() AT TIME ZONE f.timezone)::date
  ) THEN
    RAISE EXCEPTION 'Past dates are read-only. Nothing was published for this change — please refresh Review.' USING ERRCODE = 'P0001';
  END IF;

$n$ || a);
  EXECUTE d;
END $r$;