-- Historical duplicates are intentionally preserved. The trigger prevents any new
-- case-insensitive, whitespace-trimmed duplicate, including concurrent inserts.
CREATE FUNCTION reject_duplicate_subsidiary_name() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND lower(btrim(NEW.name)) = lower(btrim(OLD.name)) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(747213);
  IF EXISTS (
    SELECT 1 FROM subsidiaries
    WHERE lower(btrim(name)) = lower(btrim(NEW.name)) AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'duplicate subsidiary name' USING ERRCODE = '23505', CONSTRAINT = 'subsidiaries_name_unique';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER subsidiaries_name_unique_guard
BEFORE INSERT OR UPDATE OF name ON subsidiaries
FOR EACH ROW EXECUTE FUNCTION reject_duplicate_subsidiary_name();
