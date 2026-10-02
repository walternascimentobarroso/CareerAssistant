# Career Assistant

A personal, Markdown-first tracker for a job search: applications, job descriptions, CVs, interviews, next actions and history, all as plain files in a Git repository, with a small dashboard and local file-based backend on top.

## Philosophy

```text
Markdown = DATA
Git      = HISTORY
React    = VIEW
AI       = ASSISTANT
```

- The Markdown files are the only source of truth. There is no database.
- The dashboard reads and writes Markdown through a local API. Delete `dashboard/` tomorrow and every piece of data is still usable.
- The structure is predictable so that AI agents such as Claude Code can read and edit it directly. Their rules are in [CLAUDE.md](CLAUDE.md).

## Architecture

```text
applications/**/*.md        source of truth
        │
        ▼
frontmatter parser (yaml) + schema (Zod)      dashboard/src/domain/
        │
        ▼
normalized data ──► Kanban ──► Application detail ──► Markdown documents
        └─────────► Tasks
```

A local Node.js API reads Markdown from disk and validates writes using the shared schema. The frontend fetches current data rather than bundling documents. No database or persistent cache is used. `npm run validate` uses the same parser and schema from Node.

## Installation

Requires Node.js 22 or newer.

```bash
npm install
```

## Development

```bash
npm run dev        # dashboard + API at http://localhost:5173
npm run validate   # check every application
npm run build      # type-check and build the dashboard into dist/
npm start          # local production server at http://127.0.0.1:3000
npm test           # persistence and conflict tests
```

## File structure

```text
applications/
  <company-role>/
    application.md          structured data (YAML frontmatter) + free notes
    job-description.md
    cv.md                   the CV sent for this application
    interviews/
      01-recruiter/
        summary.md
        transcript.md
      02-technical/
cv/
  master.md                 complete CV
  backend.md, devops.md, security.md
contacts/                   optional notes about people
templates/                  application.md, job-description.md, interview-summary.md
server/                     local API, validation and atomic file writes
dashboard/                  React interface
  src/domain/               constants, schema, parsing (shared with the validator)
scripts/validate.ts
CLAUDE.md                   conventions for AI agents
```

The full field reference for `application.md` is in [CLAUDE.md](CLAUDE.md#applicationmd-schema). Allowed statuses, priorities and contract types are defined once in [dashboard/src/domain/constants.ts](dashboard/src/domain/constants.ts).

## Adding an application

```bash
mkdir applications/acme-senior-backend-engineer
cp templates/application.md applications/acme-senior-backend-engineer/application.md
cp templates/job-description.md applications/acme-senior-backend-engineer/job-description.md
```

Fill in the files and run `npm run validate`. Or ask Claude Code: *"Create an application for this job description."*

## Recording an interview

```bash
mkdir -p applications/acme-senior-backend-engineer/interviews/01-recruiter
cp templates/interview-summary.md applications/acme-senior-backend-engineer/interviews/01-recruiter/summary.md
```

Put the raw transcript in `transcript.md` next to it, then add a `timeline` entry and update `status` and `next_action` in `application.md`.

## Using the dashboard

- **Board**: one column per status, one card per application, with priority, contract type, rate and the next action. Overdue actions are red, today's are amber.
- **Tasks**: derived from each application's `next_action`, grouped into Overdue, Today, Upcoming and No date. There is no separate task list to maintain.
- **Application page**: rate, contact, next action, documents, interviews, timeline and notes. Document links render the Markdown files.

Move cards by dragging them between columns or using the status selector. Each move saves the status and appends a timeline event. Closing an application lets you retain or remove the pending next action. Task completion can still be recorded by editing `application.md`. Applications with invalid Markdown are hidden and listed in a banner at the top with the reason.

## Validating

```bash
npm run validate
```

Reports, per application: missing `application.md`, missing or broken frontmatter, missing `company` or `role`, invalid status, invalid dates, invalid `rate` structure, and unknown fields. Exits with code 1 when something is invalid.

## Demo data

The `applications/example-*` folders are fictional. Remove them with:

```bash
rm -rf applications/example-*
```

## Roadmap

Not implemented on purpose:

- CV generation: job description + master CV → AI → customized `cv.md` → PDF
- Interview processing: audio → transcription → `transcript.md` → AI analysis → `summary.md`
- Interview preparation from the job description, the CV sent and previous interviews
- Completing tasks from the dashboard
- History of completed actions
- Integrations: calendar, email, transcription, job boards, AI APIs

## Managing CVs

Open **CVs** to edit the master, create base versions, import `.md`/`.txt` files or paste text, and preview Markdown before saving. Add real experience to `cv/master.md` first; base versions must use facts from the master. PDF/DOCX extraction is not included.

On an application page, select a base CV and attach a copy. It becomes `applications/<slug>/cv.md`, with `cv: ./cv.md` in the application frontmatter. Changes to the base do not affect the copy. Replacing an existing CV after the interested stage requires checking explicit authorization.

## Persistence and local operation

The API detects stale edits using content hashes and saves files with atomic replacement. Application notes and unrelated YAML fields are preserved; timeline events are appended. No Git commits are made automatically. Writes to a CV and its application reference include rollback on ordinary failures; they are not a crash-proof transaction across two files.

Use **Reload files**, reload a CV from disk, or return focus to the window to refresh application data after external edits. Conflicting saves are rejected so you can reload and reconcile changes. CVs load when their management page opens.

The backend is intended for a single local user. Production binds to `127.0.0.1` and rejects cross-origin API access. Do not expose it publicly without adding authentication and deployment hardening. `vite preview` previews only static assets; use `npm start` for the working production app.

API routes: `GET /api/applications`, `GET /api/applications/:slug`, `PATCH /api/applications/:slug/status`, `GET /api/cvs`, `GET /api/cvs/:name`, `POST /api/cvs`, `PUT /api/cvs/:name`, and `POST /api/applications/:slug/cv`. Mutation requests use JSON and include revisions for existing files.
