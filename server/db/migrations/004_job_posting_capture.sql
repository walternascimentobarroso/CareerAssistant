-- How a job description got its text. NULL on existing rows: their origin is unknown and is not guessed.
ALTER TABLE jobs
  ADD COLUMN description_input_kind text CHECK (description_input_kind IN ('manual','url')),
  ADD COLUMN description_captured_at timestamptz,
  ADD COLUMN description_resolved_url text,
  ADD COLUMN description_capture_method text CHECK (description_capture_method IN ('json_ld','html','text')),
  ADD COLUMN description_edited_after_capture boolean,
  ADD CONSTRAINT jobs_description_capture_kind CHECK (
    (description_input_kind IS NULL AND description_captured_at IS NULL)
    OR (description_input_kind IS NOT NULL AND description_captured_at IS NOT NULL AND description_md IS NOT NULL)
  ),
  ADD CONSTRAINT jobs_description_import_details CHECK (
    CASE WHEN description_input_kind IS NOT DISTINCT FROM 'url'
      THEN description_resolved_url IS NOT NULL AND description_capture_method IS NOT NULL AND description_edited_after_capture IS NOT NULL
      ELSE description_resolved_url IS NULL AND description_capture_method IS NULL AND description_edited_after_capture IS NULL
    END
  );
