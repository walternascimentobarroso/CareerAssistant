CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''),
  website text, notes_md text, row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  title text NOT NULL CHECK (btrim(title) <> ''), contract_type text CHECK (contract_type IN ('permanent','b2b','contract')),
  location text, job_url text, description_md text, description_source text, description_captured_on date,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES jobs(id), slug text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('interested','applied','recruiter','technical_interview','final_interview','offer','accepted','rejected','archived')),
  priority text CHECK (priority IN ('high','medium','low')), applied_on date, notes_md text NOT NULL DEFAULT '',
  requested_amount numeric(19,4) CHECK (requested_amount > 0 AND requested_amount < 'Infinity'::numeric),
  minimum_amount numeric(19,4) CHECK (minimum_amount > 0 AND minimum_amount < 'Infinity'::numeric),
  currency text CHECK (currency ~ '^[A-Z]{3}$'), rate_period text CHECK (rate_period IN ('hour','day','month','year')),
  vat boolean, rate_basis text CHECK (rate_basis IN ('personal_expectation','advertised_range','unknown')),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CHECK ((currency IS NULL) = (rate_period IS NULL)),
  CHECK ((requested_amount IS NULL AND minimum_amount IS NULL AND vat IS NULL AND rate_basis IS NULL) OR currency IS NOT NULL)
);
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''), company_id uuid REFERENCES companies(id),
  role text, email text, phone text, linkedin_url text, notes_md text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE application_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), contact_id uuid NOT NULL REFERENCES contacts(id),
  relationship_role text, is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX application_contacts_pair ON application_contacts(application_id,contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX application_contacts_primary ON application_contacts(application_id) WHERE deleted_at IS NULL AND is_primary;
CREATE TABLE cvs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('master','base','tailored')), current_version_id uuid, row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE cv_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cv_id uuid NOT NULL REFERENCES cvs(id), version_number integer NOT NULL CHECK (version_number > 0),
  content_md text NOT NULL, content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  derived_from_version_id uuid REFERENCES cv_versions(id), change_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(cv_id,version_number), UNIQUE(cv_id,id), CHECK (derived_from_version_id IS DISTINCT FROM id)
);
ALTER TABLE cvs ADD CONSTRAINT cvs_current_version FOREIGN KEY (id,current_version_id) REFERENCES cv_versions(cv_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE application_cvs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), cv_version_id uuid NOT NULL REFERENCES cv_versions(id),
  state text NOT NULL CHECK (state IN ('selected','sent','legacy_unknown')), sent_on date, sent_at timestamptz, channel text, notes_md text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(application_id,id),
  CHECK ((state = 'sent' AND num_nonnulls(sent_on,sent_at) = 1) OR (state <> 'sent' AND num_nonnulls(sent_on,sent_at) = 0))
);
CREATE UNIQUE INDEX application_cvs_selected ON application_cvs(application_id) WHERE state = 'selected' AND deleted_at IS NULL;
CREATE TABLE interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), sequence_number integer NOT NULL CHECK (sequence_number > 0),
  kind text NOT NULL CHECK (btrim(kind) <> ''), status text NOT NULL CHECK (status IN ('scheduled','completed','cancelled','unknown')),
  scheduled_on date, starts_at timestamptz, ends_at timestamptz, timezone text, location text, meeting_url text,
  notes_md text, transcript_md text, summary_md text, row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(application_id,sequence_number), UNIQUE(application_id,id),
  CHECK (num_nonnulls(scheduled_on,starts_at) <= 1), CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at > starts_at))
);
CREATE TABLE interview_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), interview_id uuid NOT NULL REFERENCES interviews(id), contact_id uuid REFERENCES contacts(id),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''), role text, notes_md text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE interview_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), interview_id uuid NOT NULL REFERENCES interviews(id), provider text, model text, prompt_version text,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'), summary_md text, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), type text NOT NULL, description text NOT NULL,
  due_on date, status text NOT NULL CHECK (status IN ('pending','completed','cancelled')), is_next boolean NOT NULL DEFAULT false,
  completed_at timestamptz, cancelled_at timestamptz, row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(application_id,id), CHECK (NOT is_next OR status = 'pending'),
  CHECK ((status = 'pending' AND completed_at IS NULL AND cancelled_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL))
);
CREATE UNIQUE INDEX tasks_next ON tasks(application_id) WHERE deleted_at IS NULL AND is_next AND status = 'pending';
CREATE TABLE application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), sequence_number integer NOT NULL CHECK (sequence_number > 0),
  type text NOT NULL, description text NOT NULL, occurred_on date, occurred_at timestamptz, from_status text, to_status text,
  interview_id uuid, task_id uuid, application_cv_id uuid, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(application_id,sequence_number), CHECK (num_nonnulls(occurred_on,occurred_at) = 1),
  FOREIGN KEY (application_id,interview_id) REFERENCES interviews(application_id,id),
  FOREIGN KEY (application_id,task_id) REFERENCES tasks(application_id,id),
  FOREIGN KEY (application_id,application_cv_id) REFERENCES application_cvs(application_id,id),
  CHECK (from_status IS NULL OR from_status IN ('interested','applied','recruiter','technical_interview','final_interview','offer','accepted','rejected','archived')),
  CHECK (to_status IS NULL OR to_status IN ('interested','applied','recruiter','technical_interview','final_interview','offer','accepted','rejected','archived'))
);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''),
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('technology','skill','domain','other')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX tags_active_name ON tags(lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE TABLE application_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id), tag_id uuid NOT NULL REFERENCES tags(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX application_tags_pair ON application_tags(application_id,tag_id) WHERE deleted_at IS NULL;
CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, title text NOT NULL, content text NOT NULL, row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid REFERENCES applications(id), interview_id uuid REFERENCES interviews(id), cv_version_id uuid REFERENCES cv_versions(id),
  kind text NOT NULL, storage_uri text NOT NULL, original_filename text NOT NULL, mime_type text, size_bytes bigint CHECK (size_bytes >= 0), sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CHECK (num_nonnulls(application_id,interview_id,cv_version_id) = 1), CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$')
);
-- Exact import material and mapping, never a runtime source of domain data.
CREATE TABLE import_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_path text NOT NULL, source_revision text NOT NULL,
  content text NOT NULL, sha256 text NOT NULL, entity_id uuid, entity_type text, issues jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(source_path,source_revision)
);
CREATE INDEX jobs_company ON jobs(company_id);
CREATE INDEX applications_job ON applications(job_id);
CREATE INDEX applications_board ON applications(status,priority) WHERE deleted_at IS NULL;
CREATE INDEX contacts_company ON contacts(company_id);
CREATE INDEX application_contacts_contact ON application_contacts(contact_id);
CREATE INDEX cvs_current ON cvs(current_version_id);
CREATE INDEX cv_versions_origin ON cv_versions(derived_from_version_id);
CREATE INDEX application_cvs_version ON application_cvs(cv_version_id);
CREATE INDEX application_cvs_sent ON application_cvs(application_id,sent_at,sent_on);
CREATE INDEX interviews_date ON interviews(application_id,starts_at,scheduled_on);
CREATE INDEX participants_interview ON interview_participants(interview_id);
CREATE INDEX participants_contact ON interview_participants(contact_id);
CREATE INDEX analyses_interview ON interview_analyses(interview_id);
CREATE INDEX tasks_due ON tasks(due_on) WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX events_interview ON application_events(interview_id);
CREATE INDEX events_task ON application_events(task_id);
CREATE INDEX events_cv ON application_events(application_cv_id);
CREATE INDEX application_tags_tag ON application_tags(tag_id);
CREATE INDEX attachments_application ON attachments(application_id);
CREATE INDEX attachments_interview ON attachments(interview_id);
CREATE INDEX attachments_cv ON attachments(cv_version_id);

CREATE FUNCTION touch_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF to_jsonb(NEW) ? 'row_version' THEN NEW := jsonb_populate_record(NEW, jsonb_build_object('row_version', (to_jsonb(OLD)->>'row_version')::bigint + 1)); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Use soft delete' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'updated_at' - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'deleted_at') THEN
    RAISE EXCEPTION 'Historical content is immutable; append a new record' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION preserve_sent_cv() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('sent','legacy_unknown') AND (to_jsonb(NEW) - 'updated_at' - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'deleted_at') THEN
    RAISE EXCEPTION 'Historical CV associations are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
-- Parent row locks serialize creation/restoration against soft deletion.
CREATE FUNCTION require_active_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; removed timestamptz;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  parent_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT deleted_at FROM %I WHERE id = $1 FOR UPDATE',TG_ARGV[0]) INTO removed USING parent_id;
  IF removed IS NOT NULL THEN RAISE EXCEPTION 'Referenced record is removed: %',TG_ARGV[0] USING ERRCODE = '23514'; END IF;
  IF TG_ARGV[0] = 'applications' THEN
    PERFORM 1 FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE a.id=parent_id AND (j.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL);
  ELSIF TG_ARGV[0] = 'interviews' THEN
    PERFORM 1 FROM interviews i JOIN applications a ON a.id=i.application_id JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE i.id=parent_id AND (a.deleted_at IS NOT NULL OR j.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL);
  ELSIF TG_ARGV[0] = 'cv_versions' THEN
    PERFORM 1 FROM cv_versions v JOIN cvs c ON c.id=v.cv_id WHERE v.id=parent_id AND c.deleted_at IS NOT NULL AND NOT (TG_TABLE_NAME='cvs' AND c.id=NEW.id);
  ELSIF TG_ARGV[0] = 'jobs' THEN
    PERFORM 1 FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=parent_id AND c.deleted_at IS NOT NULL;
  ELSE RETURN NEW;
  END IF;
  IF FOUND THEN RAISE EXCEPTION 'Ancestor record is removed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_shared_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE referenced boolean := false;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='companies' THEN
    SELECT EXISTS(SELECT 1 FROM jobs WHERE company_id=OLD.id AND deleted_at IS NULL) INTO referenced;
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
  IF referenced THEN RAISE EXCEPTION 'Record has protected references' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_cv BEFORE UPDATE OR DELETE ON cv_versions FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON application_events FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER immutable_analysis BEFORE UPDATE OR DELETE ON interview_analyses FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER immutable_sent_cv BEFORE UPDATE ON application_cvs FOR EACH ROW EXECUTE FUNCTION preserve_sent_cv();
CREATE TRIGGER zz_touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_contacts FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON cvs FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON cv_versions FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_cvs FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON interview_participants FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON interview_analyses FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_events FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_tags FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON import_sources FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER active_company_id BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION require_active_parent('companies','company_id');
CREATE TRIGGER active_job_id BEFORE INSERT OR UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION require_active_parent('jobs','job_id');
CREATE TRIGGER active_company_id BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION require_active_parent('companies','company_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON application_contacts FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_contact_id BEFORE INSERT OR UPDATE ON application_contacts FOR EACH ROW EXECUTE FUNCTION require_active_parent('contacts','contact_id');
CREATE TRIGGER active_current_version_id BEFORE INSERT OR UPDATE ON cvs FOR EACH ROW EXECUTE FUNCTION require_active_parent('cv_versions','current_version_id');
CREATE TRIGGER active_cv_id BEFORE INSERT OR UPDATE ON cv_versions FOR EACH ROW EXECUTE FUNCTION require_active_parent('cvs','cv_id');
CREATE TRIGGER active_derived_from_version_id BEFORE INSERT OR UPDATE ON cv_versions FOR EACH ROW EXECUTE FUNCTION require_active_parent('cv_versions','derived_from_version_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON application_cvs FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_cv_version_id BEFORE INSERT OR UPDATE ON application_cvs FOR EACH ROW EXECUTE FUNCTION require_active_parent('cv_versions','cv_version_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_interview_id BEFORE INSERT OR UPDATE ON interview_participants FOR EACH ROW EXECUTE FUNCTION require_active_parent('interviews','interview_id');
CREATE TRIGGER active_contact_id BEFORE INSERT OR UPDATE ON interview_participants FOR EACH ROW EXECUTE FUNCTION require_active_parent('contacts','contact_id');
CREATE TRIGGER active_interview_id BEFORE INSERT OR UPDATE ON interview_analyses FOR EACH ROW EXECUTE FUNCTION require_active_parent('interviews','interview_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON application_events FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_interview_id BEFORE INSERT OR UPDATE ON application_events FOR EACH ROW EXECUTE FUNCTION require_active_parent('interviews','interview_id');
CREATE TRIGGER active_task_id BEFORE INSERT OR UPDATE ON application_events FOR EACH ROW EXECUTE FUNCTION require_active_parent('tasks','task_id');
CREATE TRIGGER active_application_cv_id BEFORE INSERT OR UPDATE ON application_events FOR EACH ROW EXECUTE FUNCTION require_active_parent('application_cvs','application_cv_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON application_tags FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_tag_id BEFORE INSERT OR UPDATE ON application_tags FOR EACH ROW EXECUTE FUNCTION require_active_parent('tags','tag_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_interview_id BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION require_active_parent('interviews','interview_id');
CREATE TRIGGER active_cv_version_id BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION require_active_parent('cv_versions','cv_version_id');
CREATE TRIGGER protected_delete BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION protect_shared_delete();
CREATE TRIGGER protected_delete BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION protect_shared_delete();
CREATE TRIGGER protected_delete BEFORE UPDATE ON cvs FOR EACH ROW EXECUTE FUNCTION protect_shared_delete();
CREATE TRIGGER protected_delete BEFORE UPDATE ON cv_versions FOR EACH ROW EXECUTE FUNCTION protect_shared_delete();

CREATE FUNCTION check_application_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM application_cvs ac JOIN cv_versions v ON v.id=ac.cv_version_id JOIN cvs c ON c.id=v.cv_id
    WHERE ac.application_id=NEW.id AND ac.deleted_at IS NULL AND (v.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Restore referenced CVs before restoring this application' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restore_dependencies BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION check_application_restore();
