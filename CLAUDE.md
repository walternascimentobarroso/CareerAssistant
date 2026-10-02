# Career Assistant — instructions for Claude Code

Personal repository that tracks a job search. Read this before touching any file.

```text
Markdown = DATA      Git = HISTORY      React = VIEW      AI = ASSISTANT
```

The Markdown files are the only source of truth. The dashboard reads and writes through a local Node.js API and has no persistent storage of its own. Never put data anywhere else (no JSON caches, no databases, no state inside `dashboard/`).

## Structure

```text
applications/<slug>/
  application.md              frontmatter = structured data, body = free notes   (required)
  job-description.md          copy of the posting                                 (optional)
  cv.md                       the exact CV sent for this application              (optional)
  interviews/<NN>-<kind>/
    summary.md                structured analysis (templates/interview-summary.md)
    transcript.md             raw transcript
cv/master.md                  the complete CV; every other CV is a subset of it
cv/<focus>.md                 base versions (backend, devops, security)
contacts/                     optional notes about people shared across applications
messages/<slug>.md            reusable messages to copy and paste: frontmatter `title`, body = the text
templates/                    files to copy when creating things
dashboard/                    Vite + React interface
server/                       local API and Markdown file operations
dashboard/src/domain/         schema, constants and parsing shared with the validator
scripts/validate.ts           `npm run validate`
```

- `<slug>` is `company-role` in lowercase kebab-case, e.g. `acme-senior-backend-engineer`. It never changes after creation.
- Interview folders are `NN-kind` with a two-digit order: `01-recruiter`, `02-technical`, `03-final`.

## Source of truth per piece of information

| Information | Lives in |
| --- | --- |
| Status, priority, rate, contact, next action, timeline, tags | `application.md` frontmatter |
| Free notes about the application | `application.md` body |
| The posting | `job-description.md` |
| What was said in an interview | `interviews/NN-kind/transcript.md` and `summary.md` |
| Career history | `cv/master.md` |
| Reusable messages | `messages/<slug>.md` |
| Allowed values and field rules | `dashboard/src/domain/constants.ts` and `schema.ts` |

Each fact lives in one place. Do not copy interview content into `application.md`; link or reference it. Documents and interviews are discovered from the files on disk, so never list them in the frontmatter.

## `application.md` schema

The schema is strict: unknown keys fail validation. To add a field, change `dashboard/src/domain/schema.ts` first.

```yaml
---
company: Stape                 # required
role: Senior PHP Developer     # required
status: technical_interview    # required, see below
priority: high                 # high | medium | low
type: b2b                      # permanent | b2b | contract
location: Remote
applied_at: 2026-10-02         # YYYY-MM-DD
job_url: https://example.com/job

rate:                          # salary or rate; currency and period are required inside it
  requested: 250
  minimum: 230
  currency: EUR                # 3-letter code
  period: day                  # hour | day | month | year
  vat: true

contact:                       # name is required inside it
  name: Example Recruiter
  role: Recruiter
  email: recruiter@example.com
  phone: "+351 000 000 000"
  linkedin: https://linkedin.com/in/example

next_action:                   # the single next thing to do; feeds the Tasks page
  type: prepare_interview      # free snake_case label
  date: 2026-10-05             # optional
  description: Prepare technical interview

cv: ./cv.md

tags: [php, symfony, backend]  # lowercase technologies and keywords

timeline:
  - date: 2026-10-02
    type: applied              # snake_case label; the dashboard offers TIMELINE_EVENT_TYPES from constants.ts
    description: Application submitted
---
```

Omit optional fields instead of leaving them empty (`applied_at:` with no value is invalid).

### Statuses

`interested` → `applied` → `recruiter` → `technical_interview` → `final_interview` → `offer` → `accepted`, plus `rejected` and `archived`.

Defined once in `dashboard/src/domain/constants.ts`. Never hardcode these strings elsewhere in code.

## How to

### Create an application

1. Create `applications/<slug>/`.
2. Copy `templates/application.md` to `application.md` and fill it in. Use `interested` if not applied yet.
3. Copy `templates/job-description.md` to `job-description.md` and paste the full original posting text unedited, then fill in the extracted sections.
4. Add technologies from the posting to `tags`.
5. Add the first `timeline` entry and a `next_action`.
6. Run `npm run validate`.

### Update an application

- Edit only the fields that changed and keep everything else byte-for-byte.
- When `status` changes, append a `timeline` entry with the date and what happened.
- Replace `next_action` with the new next step. If the action that was just completed is not in the timeline yet, add it there first so it is not lost.
- When an application is closed (`accepted`, `rejected`, `archived`), remove `next_action` unless something is still pending.
- Run `npm run validate`.

### Record an interview

1. Create `interviews/NN-kind/` with the next order number.
2. Save the raw transcript as `transcript.md`. Never edit, shorten or "clean up" a transcript.
3. Copy `templates/interview-summary.md` to `summary.md` and fill it from the transcript. Leave a section empty instead of inventing content.
4. In `application.md`: append a `timeline` entry (`type: interview`), update `status` if the stage changed, update `next_action`, and update `rate` or `contact` if the interview revealed new facts.

### Update the timeline

- Append only. Never delete or rewrite past entries; fix them only if they are factually wrong.
- One entry per real event, with the date it happened (not the date it was recorded).
- Future scheduled events may be listed, with a description that says they are scheduled.

### CVs

- `cv/master.md` is the complete history. New experience is added there first.
- `cv/<focus>.md` are base versions derived from the master.
- `applications/<slug>/cv.md` is the CV actually sent. To customize one: read `cv/master.md` and the application's `job-description.md`, select and reword what is relevant, and write `cv.md` in the application folder.
- Never invent experience, dates, titles or numbers that are not in `cv/master.md`.
- After a CV has been sent (`status` beyond `interested`), treat that `cv.md` as a historical record and do not edit it unless asked.

### Answering questions

- "Which applications need my attention today?" → read every `next_action` and compare `date` with today; overdue and today come first.
- "Which technologies appear most often?" → aggregate `tags` across applications and the Technologies sections of `job-description.md`.
- "Prepare me for an interview" → read the application's `job-description.md`, `cv.md` and every previous `interviews/*/summary.md`.

## Rules for not losing information

- Never delete an application folder, transcript, summary or timeline entry unless explicitly asked. Use `status: archived` instead of deleting. The one exception is the dashboard's delete button, which the user triggers and confirms, and which only works while `status` is `interested`.
- Messages in `messages/` are not history: the Messages page creates, edits and deletes them, with a confirmation before deleting. Their slug comes from the first title and never changes; the body is copied as plain text, so keep it free of Markdown that would look wrong when pasted.
- Never overwrite the notes in the body of `application.md`; append to them.
- Never rename an application folder.
- Keep everything as plain Markdown text. No binary files, no generated data files.
- After any change under `applications/` or `messages/`, run `npm run validate` and fix what it reports.
- Do not commit unless asked. Git history is the audit trail, so keep commits small and descriptive.

## Dashboard code

- `npm run dev` starts it, `npm run build` type-checks and builds, `npm run validate` checks the Markdown.
- The dashboard writes only through `server/`; Markdown remains the only source of truth. Never add a database.
- `npm run dev` serves the dashboard and API together. `npm run build && npm start` serves production locally. `npm test` checks persistence safeguards.
- API writes require the current content hash. Reject stale edits rather than overwriting external changes.
- Applications are created and edited through forms. Field edits rewrite only the keys that changed; `status`, `timeline` and `cv` are not editable fields and go through their own operations.
- From the browser the timeline and the notes are append-only, and the job description form keeps content it has no field for.
- Status changes append a timeline event and the first move to `applied` fills `applied_at`; same-status requests are no-ops. Closing a candidature removes next_action unless the user chooses to retain it.
- CV imports accept Markdown/plain text. Base CV attachment creates an independent application copy. Replacing an existing historical CV requires explicit authorization.
- Preserve notes byte-for-byte, use atomic replacement, and reject paths or symlinks outside the allowed document locations.
- AI extraction (`server/ai.ts`) only proposes values for the New application form; it never writes files. Provider keys and the default provider/model live in the git-ignored `.env`; never return a key to the browser, log it or commit it. Send providers the pasted posting text only.
- The backend is for local use and binds to loopback; do not expose it publicly.
- `dashboard/src/domain/` has no React and no Vite-specific code because `scripts/validate.ts` imports it.
