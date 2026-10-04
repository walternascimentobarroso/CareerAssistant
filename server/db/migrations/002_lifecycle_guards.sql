-- A company's active contacts are dependencies too. CV versions remain protected
-- even when their application association is soft-deleted.
CREATE OR REPLACE FUNCTION protect_shared_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE referenced boolean := false;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='companies' THEN
    SELECT EXISTS(SELECT 1 FROM jobs WHERE company_id=OLD.id AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM contacts WHERE company_id=OLD.id AND deleted_at IS NULL) INTO referenced;
  ELSIF TG_TABLE_NAME='jobs' THEN
    SELECT EXISTS(SELECT 1 FROM applications WHERE job_id=OLD.id AND deleted_at IS NULL) INTO referenced;
  ELSIF TG_TABLE_NAME='cvs' THEN
    SELECT EXISTS(SELECT 1 FROM cv_versions v JOIN application_cvs ac ON ac.cv_version_id=v.id JOIN applications a ON a.id=ac.application_id
      WHERE v.cv_id=OLD.id AND ac.deleted_at IS NULL AND a.deleted_at IS NULL) INTO referenced;
  ELSIF TG_TABLE_NAME='cv_versions' THEN
    SELECT EXISTS(SELECT 1 FROM cvs WHERE current_version_id=OLD.id)
      OR EXISTS(SELECT 1 FROM cv_versions WHERE derived_from_version_id=OLD.id)
      OR EXISTS(SELECT 1 FROM application_cvs WHERE cv_version_id=OLD.id) INTO referenced;
  END IF;
  IF referenced THEN RAISE EXCEPTION 'Record has protected references' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION require_active_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; existing_id uuid; removed timestamptz; ancestor_removed boolean := false;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  parent_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT id,deleted_at FROM %I WHERE id=$1 FOR UPDATE',TG_ARGV[0]) INTO existing_id,removed USING parent_id;
  IF existing_id IS NULL THEN RAISE EXCEPTION 'Referenced parent must exist first' USING ERRCODE='23503'; END IF;
  IF removed IS NOT NULL THEN RAISE EXCEPTION 'Referenced record is removed: %',TG_ARGV[0] USING ERRCODE='23514'; END IF;
  IF TG_ARGV[0]='applications' THEN
    SELECT EXISTS(SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE a.id=parent_id AND (j.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)) INTO ancestor_removed;
  ELSIF TG_ARGV[0]='interviews' THEN
    SELECT EXISTS(SELECT 1 FROM interviews i JOIN applications a ON a.id=i.application_id JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE i.id=parent_id AND (a.deleted_at IS NOT NULL OR j.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)) INTO ancestor_removed;
  ELSIF TG_ARGV[0]='cv_versions' THEN
    SELECT EXISTS(SELECT 1 FROM cv_versions v JOIN cvs c ON c.id=v.cv_id
      WHERE v.id=parent_id AND c.deleted_at IS NOT NULL AND NOT (TG_TABLE_NAME='cvs' AND c.id=NEW.id)) INTO ancestor_removed;
  ELSIF TG_ARGV[0]='jobs' THEN
    SELECT EXISTS(SELECT 1 FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=parent_id AND c.deleted_at IS NOT NULL) INTO ancestor_removed;
  ELSIF TG_ARGV[0] IN ('tasks','application_cvs') THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I child JOIN applications a ON a.id=child.application_id JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id WHERE child.id=$1 AND (a.deleted_at IS NOT NULL OR j.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL))',TG_ARGV[0]) INTO ancestor_removed USING parent_id;
  END IF;
  IF ancestor_removed THEN RAISE EXCEPTION 'Ancestor record is removed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
