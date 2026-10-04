# Career Assistant

Personal job-search tracker with a React dashboard, local Node.js API and **PostgreSQL as the source of truth**. Job descriptions, CVs, transcripts, summaries and notes remain Markdown text stored in PostgreSQL. Binary files live outside the database.

## Setup

Requires Node.js 22+ and PostgreSQL 18 (or Docker Compose).

```bash
npm install
docker compose up -d
```

Add these entries to `.env`, preserving any existing AI credentials:

```dotenv
DATABASE_URL=postgresql://career_assistant:career_assistant_local@127.0.0.1:5433/career_assistant
APP_TIMEZONE=Europe/Lisbon
```

`.env.example` contains the configuration reference. The Compose database binds only to localhost, uses a persistent named volume and accepts an optional `POSTGRES_PASSWORD` override. Match that password in `DATABASE_URL`.

```bash
npm run db:migrate
npm run dev                   # dashboard + API at http://localhost:5173
```

For production:

```bash
npm run build
npm start                     # http://127.0.0.1:3000
```

Migrations are explicit, transactional and checksum-checked. Startup does not apply migrations automatically. A missing `DATABASE_URL` fails startup; there is no file-storage fallback.

## Architecture

```text
React → local HTTP API → domain operations → PostgreSQL
                                               ├─ structured relations
                                               ├─ Markdown TEXT
                                               └─ file references / metadata
```

- [server/postgres-store.ts](server/postgres-store.ts) implements transactional operations and active-record queries.
- [server/db/migrations/](server/db/migrations/) contains the schema, constraints, indexes and lifecycle protections.
- [server/store.ts](server/store.ts) holds shared errors and the guarded file access used only for `.env` and static assets.
- [dashboard/src/domain/](dashboard/src/domain/) shares validation, Markdown parsers, exact decimal rules and display helpers.

## Using the dashboard

- **Board:** move applications between statuses. A move records the previous and new status atomically; repeated moves to the same status are no-ops. Applying fills the first application date. Closing can retain the next action or cancel it while preserving its history.
- **New application:** import a posting from its link or paste it, review the text, then request an AI proposal (or fill in manually) and review it before saving. Importing uses no AI and saves nothing; the reviewed text and where it came from are stored with the application. Duplicate company/role combinations receive different UUIDs and suffixed slugs.
- **Application:** edit fields, append notes and events, edit the job description, select or customize a CV, record its submission, complete tasks and add interviews.
- **Tasks:** overdue, today, upcoming and undated next actions. Completed and cancelled tasks remain in each application's history.
- **CVs:** edit the master, create base CVs derived from a specific version, import Markdown/plain text and inspect old versions. Each saved change creates an immutable version. Loading an old version into the editor and saving creates a new version.
- **CV history:** selection and submission are separate operations. Selecting another version preserves prior submissions. Tailored CVs point to the exact source version. Legacy copies are marked as having unknown submission provenance.
- **Interviews:** record type, date, participants, notes, transcript and summary. The API also accepts timestamps with explicit offsets and an IANA timezone. Analyses and external attachments have dedicated schema support; automatic transcription and AI interview processing are not implemented.
- **Messages:** reusable plain-text templates, with optimistic concurrency and soft delete. Restore is available through the API.
- **Trash:** restore removed applications. Restoration does not reactivate individually removed children.

Dates without a known time remain `DATE`. Instants use `TIMESTAMPTZ`. `APP_TIMEZONE` controls calendar-day display and due dates. Monetary API values are decimal strings, stored as `NUMERIC(19,4)` without JavaScript floating-point conversions. Rate basis distinguishes personal expectations, advertised ranges and unknown legacy values.

## Soft delete and historical records

All domain tables have UUID identifiers and `created_at`, `updated_at`, `deleted_at`. Normal queries exclude removed records and children of removed application/interview parents.

Application removal preserves its children. Slugs remain reserved after removal. Restoration may fail if necessary shared references were removed; restore those dependencies first. Companies and jobs with active dependencies cannot be removed. CV versions that are current, origins of other versions or referenced by application CV records are protected.

CV content, sent CV associations, timeline events and AI analysis results are immutable at the database level. New versions or corrective events preserve the original records. Mutable writes use `row_version` and reject stale revisions with HTTP 409.

## Legacy data

The original Markdown files (`applications/`, `cv/`, `contacts/`, `messages/`) were imported once and removed from the repository. Their exact text remains in the `import_sources` table and in Git history. Legacy rates imported without a known basis (e.g. Coinspaid `75`/`65 EUR/year`) keep `rate_basis = unknown`.

## Importing a posting from a link

`POST /api/job-postings/fetch` downloads a public page on the server and returns plain text for review: a JSON-LD `JobPosting` when the page has one, otherwise the page's main content. It never calls an AI provider and never writes to the database.

- Only `http(s)` links on ports 80/443 without credentials. Local, private and other non-global addresses are refused, on the first request and on each of at most five redirects; the connection goes to the address that was validated.
- 15 seconds in total, 2 MiB of decompressed content, HTML or plain text only, two imports at a time. No cookies or credentials are sent.
- Pages that need JavaScript, a login or a human check are not supported; the dashboard then asks you to paste the text. Failures return `{ error, code }` with a stable `code` such as `BLOCKED_DESTINATION`, `FETCH_TIMEOUT` or `NO_JOB_CONTENT`.

Creating the application stores the reviewed text in `jobs.description_md` together with its provenance (`manual` or `url`, capture instant, requested and final link, extraction method, whether the text was edited after import). These values are declared by the client, not an audit trail. Descriptions created before migration `004_job_posting_capture.sql` keep an unknown provenance. Run `npm run db:migrate` after updating.

## AI configuration

Groq and Gemini extraction uses their OpenAI-compatible interfaces. Settings stores provider keys and defaults in `.env`; keys stay on the server. Only the posting supplied for extraction is sent to the provider. Existing CVs, transcripts and notes are not sent automatically.

```dotenv
GROQ_API_KEY=...
GEMINI_API_KEY=...
AI_PROVIDER=groq
AI_MODEL=...
```

## Verification

```bash
npm run build
npm test
```

PostgreSQL integration tests need a disposable test database:

```bash
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:55433/career_test npm test
```

Tests create isolated schemas, run migrations and clean up those schemas. Without `TEST_DATABASE_URL`, integration tests are reported as skipped. They verify concurrency, decimal precision, immutable versions, CV ancestry and submissions, FK ownership, soft delete and restore.

Export a read-only Markdown snapshot to a new directory:

```bash
npm run db:export -- --output ./exports/new-directory
```

The parent directory must exist; the exporter refuses an existing destination. It exports active documents, available CV versions and messages, not a complete database backup.

Back up PostgreSQL with `pg_dump` and back up externally stored binaries separately. Git is code history; it is not the operational data backup. Do not remove the Compose volume without a database backup.

## API

Existing application, CV, message, settings, model-listing and extraction routes remain available. Application and CV reads expose UUIDs and revision tokens; application routes accept either UUID or preserved slug.

Additional routes:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/config` | Personal timezone |
| GET | `/api/trash` | Removed applications and restore revisions |
| POST | `/api/applications/:id/restore` | Restore an application |
| GET | `/api/cvs/:name/versions` | Immutable CV version history |
| POST | `/api/applications/:id/cv-customize` | Create and select a tailored version |
| POST | `/api/applications/:id/cv-send` | Record submission of a selected version |
| POST | `/api/applications/:id/task-complete` | Complete a task and record an event |
| POST | `/api/applications/:id/interviews` | Record an interview and participants |
| POST | `/api/messages/:slug/restore` | Restore a message |
| POST | `/api/job-postings/fetch` | Fetch a public posting as text to review |

Mutations use JSON. Application mutations require `revision`; CV saves require the current CV revision. Job-description saves use `jobRevision` (or `null` when creating the document). CV selection uses source revision and the displayed application-CV association UUID, not a Markdown hash.

The server binds to `127.0.0.1` and rejects cross-origin API access. It remains a personal local application.

### Personal profile

The **Personal profile** page (`/profile`, under the dashboard hash router) stores one reusable, optional profile in PostgreSQL. It includes contact details, current residence, work authorization and sponsorship separately per country, manually entered experience, availability, salary expectations, contract/remote preferences and languages. Settings remains dedicated to AI configuration.

`GET /api/profile` returns `{ profile: null }` until saved, or the full profile with its revision. `PUT /api/profile` accepts all profile fields plus `revision` (`null` for first creation); it saves the profile and lists atomically and returns the saved profile. Invalid fields return HTTP 400 with field errors; stale saves and concurrent creation return HTTP 409. Removed list items use soft deletion. Apply the new `005_personal_profile.sql` migration through the explicit `npm run db:migrate` command before using the page.

On a new application, **Use profile salary defaults** applies a complete personal salary expectation. Existing salary data requires confirmation before replacement, including advertised ranges. Applied values are independent snapshots with `personal_expectation` as their basis. Residence, eligibility, language and job preferences are not copied into vacancy facts; editing a profile does not change previous applications or CV versions. Profile data is not sent automatically to AI or imported from CVs.

Profile domain tests run with `npm test`. PostgreSQL tests (`npm run test:postgres`) require `TEST_DATABASE_URL` and use an isolated schema to verify concurrency, decimal precision, uniqueness, atomic rollback and soft deletion.
