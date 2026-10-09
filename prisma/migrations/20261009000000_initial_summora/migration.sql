CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'member',
  daily_quota integer NOT NULL DEFAULT 200 CHECK (daily_quota > 0)
);

CREATE TABLE drafts (
  owner uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body jsonb NOT NULL,
  updated double precision NOT NULL
);

CREATE TABLE prompts (
  owner uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE jobs (
  id text PRIMARY KEY,
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idem text NOT NULL,
  digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','cancelling','cancelled','completed','failed','interrupted')),
  body jsonb NOT NULL,
  state jsonb NOT NULL,
  created double precision NOT NULL,
  day text NOT NULL,
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  charged integer NOT NULL DEFAULT 0 CHECK (charged >= 0),
  cancel boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT jobs_owner_idem_unique UNIQUE(owner, idem)
);
CREATE INDEX jobs_queue_idx ON jobs(status, created) WHERE deleted = false;
CREATE INDEX jobs_owner_created_idx ON jobs(owner, created DESC) WHERE deleted = false;
CREATE INDEX jobs_day_idx ON jobs(day);

CREATE TABLE worker (
  id integer PRIMARY KEY CHECK (id = 1),
  heartbeat double precision NOT NULL
);

CREATE TABLE limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires double precision NOT NULL
);

CREATE OR REPLACE FUNCTION public.handle_new_summora_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(user_id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_summora
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_summora_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users own drafts" ON drafts FOR ALL TO authenticated USING (auth.uid() = owner) WITH CHECK (auth.uid() = owner);
CREATE POLICY "Users own prompts" ON prompts FOR ALL TO authenticated USING (auth.uid() = owner) WITH CHECK (auth.uid() = owner);
CREATE POLICY "Users own jobs" ON jobs FOR ALL TO authenticated USING (auth.uid() = owner) WITH CHECK (auth.uid() = owner);

GRANT SELECT ON profiles TO authenticated;
REVOKE ALL ON drafts, prompts, jobs, worker, limits FROM anon, authenticated;
