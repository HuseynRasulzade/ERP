-- Defensive safety net: a session that goes idle-in-transaction (holds
-- open row locks while waiting indefinitely for the next client command)
-- must never be allowed to hang forever. Under very high write
-- concurrency against a single contended row (e.g. NumberingService's
-- `SELECT ... FOR UPDATE` on a NumberSequence), an interactive-transaction
-- client/engine hiccup can otherwise leave one connection stuck holding
-- the lock while every other concurrent allocator queues up behind it
-- with no bound — observed directly via `pg_stat_activity` (a session in
-- state 'idle in transaction' / wait_event 'ClientRead' that never
-- receives a COMMIT). Postgres will now proactively abort any such
-- session for THIS database after 15 seconds, releasing its locks so the
-- rest of the queue can proceed instead of hanging the whole app.
--
-- Applied at the database level (via current_database(), not a specific
-- role) so it takes effect regardless of which DB user the app connects
-- as in a given environment.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L',
    current_database(),
    '15s'
  );
END $$;
