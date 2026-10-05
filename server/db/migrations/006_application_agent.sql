CREATE TABLE knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept TEXT NOT NULL CHECK (concept ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  question TEXT NOT NULL CHECK (btrim(question) <> ''),
  language TEXT NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  category TEXT NOT NULL CHECK (category IN ('work_authorization','experience','compensation','availability','relocation','personal','motivation','other')),
  answer JSONB NOT NULL,
  -- context_key is the normalized form of context, so equal restrictions collide whatever their order.
  context JSONB NOT NULL DEFAULT '[]', context_key TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'USER' CHECK (origin IN ('PROFILE','KNOWLEDGE_BASE','CV','AI_INFERRED','AI_GENERATED','USER','UNKNOWN')),
  confirmed_at TIMESTAMPTZ,
  row_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX knowledge_entries_active ON knowledge_entries(concept,language,context_key) WHERE deleted_at IS NULL;
CREATE TABLE knowledge_question_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entry_id UUID NOT NULL REFERENCES knowledge_entries(id),
  question TEXT NOT NULL CHECK (btrim(question) <> ''), normalized_question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX knowledge_question_aliases_active ON knowledge_question_aliases(entry_id,normalized_question) WHERE deleted_at IS NULL;
CREATE TABLE application_preparations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL REFERENCES applications(id),
  country TEXT CHECK (country ~ '^[A-Z]{2}$'), language TEXT NOT NULL DEFAULT 'en' CHECK (language ~ '^[a-z]{2}$'),
  cv_version_id UUID REFERENCES cv_versions(id), cv_required BOOLEAN NOT NULL DEFAULT true,
  row_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX application_preparations_active ON application_preparations(application_id) WHERE deleted_at IS NULL;
CREATE INDEX application_preparations_cv ON application_preparations(cv_version_id);
-- Answers are snapshots: later edits to the profile, knowledge base or CV never rewrite them.
CREATE TABLE application_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), preparation_id UUID NOT NULL REFERENCES application_preparations(id),
  question TEXT NOT NULL CHECK (btrim(question) <> ''), concept TEXT CHECK (concept ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  answer_type TEXT NOT NULL CHECK (answer_type IN ('text','boolean','number','single_select','multi_select','money')),
  options JSONB NOT NULL DEFAULT '[]', required BOOLEAN NOT NULL DEFAULT true,
  answer JSONB,
  source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (source IN ('PROFILE','KNOWLEDGE_BASE','CV','AI_INFERRED','AI_GENERATED','USER','UNKNOWN')),
  confidence TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (confidence IN ('VERIFIED','HIGH','MEDIUM','LOW','REVIEW_REQUIRED','UNKNOWN')),
  evidence JSONB, review_reason TEXT,
  approval TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','accepted','rejected')), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  CHECK (approval <> 'accepted' OR (answer IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX application_answers_preparation ON application_answers(preparation_id);

CREATE TRIGGER zz_touch BEFORE UPDATE ON knowledge_entries FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON knowledge_question_aliases FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_preparations FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER zz_touch BEFORE UPDATE ON application_answers FOR EACH ROW EXECUTE FUNCTION touch_record();
CREATE TRIGGER active_entry_id BEFORE INSERT OR UPDATE ON knowledge_question_aliases FOR EACH ROW EXECUTE FUNCTION require_active_parent('knowledge_entries','entry_id');
CREATE TRIGGER active_application_id BEFORE INSERT OR UPDATE ON application_preparations FOR EACH ROW EXECUTE FUNCTION require_active_parent('applications','application_id');
CREATE TRIGGER active_cv_version_id BEFORE INSERT OR UPDATE ON application_preparations FOR EACH ROW EXECUTE FUNCTION require_active_parent('cv_versions','cv_version_id');
CREATE TRIGGER active_preparation_id BEFORE INSERT OR UPDATE ON application_answers FOR EACH ROW EXECUTE FUNCTION require_active_parent('application_preparations','preparation_id');

-- A CV version fixed by a preparation is a dependency, like one referenced by an application CV record.
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
      OR EXISTS(SELECT 1 FROM application_cvs WHERE cv_version_id=OLD.id)
      OR EXISTS(SELECT 1 FROM application_preparations WHERE cv_version_id=OLD.id) INTO referenced;
  END IF;
  IF referenced THEN RAISE EXCEPTION 'Record has protected references' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
