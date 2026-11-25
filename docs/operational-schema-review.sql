-- REVIEW ONLY. Not part of infra/sql automatic migration sequence.
-- Provision dedicated roles separately: open_order_ops_owner NOLOGIN,
-- open_order_ops_writer LOGIN, open_order_ops_reader NOLOGIN, open_order_ops_purger LOGIN.
-- No role memberships for writer/purger except their own role. Run as a migration
-- principal allowed to SET ROLE to the owner. Do not run as the application pool.
BEGIN;
SET LOCAL ROLE open_order_ops_owner;
CREATE SCHEMA open_order_ops AUTHORIZATION open_order_ops_owner;
REVOKE ALL ON SCHEMA open_order_ops FROM PUBLIC;
CREATE TABLE open_order_ops.events (
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  request_id uuid PRIMARY KEY CHECK (request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  route text NOT NULL CHECK (route IN ('search','ai_answer')),
  outcome text NOT NULL CHECK (outcome IN ('completed','invalid','failed','incomplete')),
  elapsed_ms integer NOT NULL CHECK (elapsed_ms BETWEEN 0 AND 900000),
  result_count integer CHECK (result_count BETWEEN 0 AND 100000),
  stage_count integer NOT NULL CHECK (stage_count BETWEEN 0 AND 1000),
  last_stage text NOT NULL CHECK (last_stage IN ('none','planning','retrieving','selecting','answering','validating','other')),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (route <> 'search' OR (stage_count = 0 AND last_stage = 'none')),
  CHECK (route <> 'ai_answer' OR result_count IS NULL)
);
CREATE INDEX events_created_at ON open_order_ops.events (created_at);
CREATE TABLE open_order_ops.expiry_health (
  singleton boolean PRIMARY KEY CHECK (singleton),
  last_success timestamptz NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA open_order_ops FROM PUBLIC, open_order_ops_writer, open_order_ops_reader, open_order_ops_purger;
CREATE FUNCTION open_order_ops.record_event_v1(
  p_version smallint, p_id uuid, p_route text, p_outcome text, p_ms integer,
  p_count integer, p_stages integer, p_stage text, p_release text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user <> 'open_order_ops_writer' OR NOT EXISTS (
    SELECT 1 FROM open_order_ops.expiry_health WHERE singleton
      AND last_success >= clock_timestamp() - interval '2 hours'
      AND last_success <= clock_timestamp()
  ) THEN RETURN false; END IF;
  INSERT INTO open_order_ops.events (schema_version,request_id,route,outcome,elapsed_ms,result_count,stage_count,last_stage,release_sha)
  VALUES (p_version,p_id,p_route,p_outcome,p_ms,p_count,p_stages,p_stage,p_release)
  ON CONFLICT (request_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
CREATE FUNCTION open_order_ops.purge_expired_v1() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE removed integer;
BEGIN
  IF session_user <> 'open_order_ops_purger' THEN RAISE EXCEPTION 'Unauthorized purge role'; END IF;
  -- Serialize purge workers; one bounded batch. Heartbeat only after backlog cleared.
  PERFORM pg_advisory_xact_lock(167208129, 1);
  DELETE FROM open_order_ops.events WHERE request_id IN (
    SELECT request_id FROM open_order_ops.events WHERE created_at <= clock_timestamp() - interval '14 days'
    ORDER BY created_at LIMIT 5000
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF NOT EXISTS (SELECT 1 FROM open_order_ops.events WHERE created_at <= clock_timestamp() - interval '14 days') THEN
    INSERT INTO open_order_ops.expiry_health VALUES (true, clock_timestamp())
    ON CONFLICT (singleton) DO UPDATE SET last_success = EXCLUDED.last_success;
  ELSE
    DELETE FROM open_order_ops.expiry_health;
  END IF;
  RETURN removed;
END;
$$;
CREATE VIEW open_order_ops.active_events WITH (security_barrier=true) AS
 SELECT schema_version,request_id,route,outcome,elapsed_ms,result_count,stage_count,last_stage,release_sha,created_at
 FROM open_order_ops.events WHERE created_at > clock_timestamp() - interval '14 days';
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA open_order_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA open_order_ops TO open_order_ops_writer, open_order_ops_reader, open_order_ops_purger;
GRANT EXECUTE ON FUNCTION open_order_ops.record_event_v1(smallint,uuid,text,text,integer,integer,integer,text,text) TO open_order_ops_writer;
GRANT EXECUTE ON FUNCTION open_order_ops.purge_expired_v1() TO open_order_ops_purger;
GRANT SELECT ON open_order_ops.active_events TO open_order_ops_reader;
COMMIT;
