-- History may only be purged when its owning application is already in Trash.
CREATE OR REPLACE FUNCTION preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; removed timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'application_events' THEN
      owner_id := OLD.application_id;
    ELSIF TG_TABLE_NAME = 'interview_analyses' THEN
      SELECT application_id INTO owner_id FROM interviews WHERE id=OLD.interview_id;
    END IF;
    IF owner_id IS NOT NULL THEN
      SELECT deleted_at INTO removed FROM applications WHERE id=owner_id FOR UPDATE;
      IF removed IS NOT NULL THEN RETURN OLD; END IF;
    END IF;
    RAISE EXCEPTION 'Use soft delete' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'updated_at' - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'deleted_at') THEN
    RAISE EXCEPTION 'Historical content is immutable; append a new record' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
