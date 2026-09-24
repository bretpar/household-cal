CREATE TABLE public.native_auth_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text UNIQUE,
  code_expires_at timestamptz,
  refresh_token_enc text,
  completed_at timestamptz,
  consumed_at timestamptz
);
GRANT ALL ON public.native_auth_handoffs TO service_role;
ALTER TABLE public.native_auth_handoffs ENABLE ROW LEVEL SECURITY;
CREATE INDEX native_auth_handoffs_expires_idx ON public.native_auth_handoffs (expires_at);