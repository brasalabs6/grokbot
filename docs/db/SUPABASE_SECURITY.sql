-- GrokBot / Supabase: secure-by-default public schema.
-- Apply only to a GrokBot-only database, after Drizzle schema migrations.
-- Idempotent and compatible with isolated CI PostgreSQL without Supabase roles.
-- The backend uses a server-only DB connection and enforces ownership in API queries.
DO $grokbot_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User', 'Chat', 'Message_v2', 'Vote_v2', 'Document', 'Suggestion', 'Stream', 'AgentApproval', 'AgentBackup', 'AgentEvent', 'AgentOperation', 'AgentRun', 'AgentSandbox', 'AgentSession', 'AgentTerminal']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    -- Optional dedicated backend login created/activated securely by an operator.
    -- An ordinary runtime login must not bypass other users' tables.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grokbot_runtime') THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO grokbot_runtime');
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO grokbot_runtime', table_name);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = table_name
           AND policyname = 'grokbot_runtime_only'
      ) THEN
        EXECUTE format('CREATE POLICY grokbot_runtime_only ON public.%I FOR ALL TO grokbot_runtime USING (true) WITH CHECK (true)', table_name);
      END IF;
    END IF;
  END LOOP;
END;
$grokbot_rls$;
