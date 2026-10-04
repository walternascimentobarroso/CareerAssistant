CREATE TABLE personal_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, email TEXT, phone TEXT, city TEXT, country TEXT CHECK (country ~ '^[A-Z]{2}$'), linkedin TEXT, github TEXT, website TEXT,
  years_of_experience NUMERIC(4,1) CHECK (years_of_experience >= 0),
  notice_type TEXT NOT NULL DEFAULT 'unknown' CHECK (notice_type IN ('immediate','duration','negotiable','unknown')),
  notice_quantity INTEGER CHECK (notice_quantity > 0 AND notice_quantity <= 10000), notice_unit TEXT CHECK (notice_unit IN ('days','weeks','months')), available_from DATE,
  salary_expected NUMERIC(19,4) CHECK (salary_expected > 0), salary_minimum NUMERIC(19,4) CHECK (salary_minimum > 0),
  salary_currency TEXT CHECK (salary_currency ~ '^[A-Z]{3}$'), salary_period TEXT CHECK (salary_period IN ('hour','day','month','year')), salary_vat BOOLEAN,
  remote_preference TEXT CHECK (remote_preference IN ('remote_only','remote_preferred','hybrid','onsite','flexible')),
  row_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  CHECK ((notice_type='duration' AND notice_quantity IS NOT NULL AND notice_unit IS NOT NULL) OR (notice_type<>'duration' AND notice_quantity IS NULL AND notice_unit IS NULL)),
  CHECK ((salary_expected IS NOT NULL AND salary_currency IS NOT NULL AND salary_period IS NOT NULL) OR (salary_expected IS NULL AND salary_minimum IS NULL AND salary_currency IS NULL AND salary_period IS NULL AND salary_vat IS NULL)),
  CHECK (salary_minimum <= salary_expected)
);
CREATE UNIQUE INDEX personal_profiles_single_active ON personal_profiles ((true)) WHERE deleted_at IS NULL;
CREATE TABLE personal_profile_work_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID NOT NULL REFERENCES personal_profiles(id),
  country TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'), "authorization" TEXT NOT NULL DEFAULT 'unknown' CHECK ("authorization" IN ('authorized','not_authorized','unknown')),
  sponsorship TEXT NOT NULL DEFAULT 'unknown' CHECK (sponsorship IN ('yes','no','unknown')), notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE personal_profile_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID NOT NULL REFERENCES personal_profiles(id), code TEXT NOT NULL CHECK (code ~ '^[a-z]{2}$'),
  level TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2','native','unspecified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE personal_profile_contract_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID NOT NULL REFERENCES personal_profiles(id), contract_type TEXT NOT NULL CHECK (contract_type IN ('permanent','b2b','contract')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX profile_authorization_active ON personal_profile_work_authorizations(profile_id,country) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX profile_language_active ON personal_profile_languages(profile_id,code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX profile_contract_active ON personal_profile_contract_preferences(profile_id,contract_type) WHERE deleted_at IS NULL;
CREATE TRIGGER touch_record BEFORE UPDATE ON personal_profiles FOR EACH ROW EXECUTE FUNCTION touch_record();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['personal_profile_work_authorizations','personal_profile_languages','personal_profile_contract_preferences'] LOOP
    EXECUTE format('CREATE TRIGGER touch_record BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_record()', t);
    EXECUTE format('CREATE TRIGGER active_profile BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION require_active_parent(''personal_profiles'',''profile_id'')', t);
  END LOOP;
END $$;
