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
messages/
  <slug>.md                 reusable message: `title` in the frontmatter, text in the body
templates/                  application.md, job-description.md, interview-summary.md
server/                     local API, validation and atomic file writes
dashboard/                  React interface
  src/domain/               constants, schema, parsing (shared with the validator)
scripts/validate.ts
CLAUDE.md                   conventions for AI agents
```

The full field reference for `application.md` is in [CLAUDE.md](CLAUDE.md#applicationmd-schema). Allowed statuses, priorities and contract types are defined once in [dashboard/src/domain/constants.ts](dashboard/src/domain/constants.ts).

## Adding an application

In the dashboard, open **New application**. Step 1: paste the posting text and click **Extract fields**; the chosen AI model proposes company, role, location, contract type, rate, contact, tags and the job description lists. Step 2: review the form (fields filled by AI are highlighted), adjust and click **Create application**. Nothing is written until then. **Fill in manually** skips the AI. The folder name is derived from company and role and never changes. To do the same by hand:

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

Move cards by dragging them between columns or using the status selector. Each move saves the status and appends a timeline event; the first move to Applied also fills `applied_at`. Closing an application lets you retain or remove the pending next action.

On an application page, **Edit application** opens a form for the frontmatter fields (job, rate, contact, next action, tags). **Add event** appends to the timeline and **Add note** appends to the notes; past events and existing notes are never rewritten from the browser. An application still in **Interested** can be deleted from its page (red button, with confirmation); this removes its folder from disk, so only Git can bring it back, and only if it was committed. Later stages are closed with Rejected or Archived instead. **Edit job description** (or **Add job description**) opens a form with one field per section of `job-description.md`; content the form has no field for is kept under "Other content". Applications with invalid Markdown are hidden and listed in a banner at the top with the reason.

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
- Integrations: calendar, email, transcription, job boards

## AI settings

Extraction uses Groq or Gemini through their OpenAI-compatible APIs. Open **Settings** to paste API keys, test them and choose the default provider and model; the provider and model can also be changed per extraction on the New application page. Settings live in `.env` at the project root, which Git ignores:

```bash
GROQ_API_KEY=...
GEMINI_API_KEY=...
AI_PROVIDER=groq          # optional, groq is the default
AI_MODEL=...              # optional, each provider has a default
```

Keys never leave the server: the browser only learns whether a key is saved. Only the posting text you paste is sent to the provider; CVs, notes and interviews never are.

## Managing CVs

Open **CVs** to edit the master, create base versions, import `.md`/`.txt` files or paste text, and preview Markdown before saving. Add real experience to `cv/master.md` first; base versions must use facts from the master. PDF/DOCX extraction is not included.

On an application page, select a base CV and attach a copy. It becomes `applications/<slug>/cv.md`, with `cv: ./cv.md` in the application frontmatter. Changes to the base do not affect the copy. Replacing an existing CV after the interested stage requires checking explicit authorization.

## Reusable messages

Open **Messages** to keep the texts you send again and again (a reply to a recruiter, a follow-up, a rate answer). Each one is a card in a responsive grid with **Copy**, **Edit** and **Delete**; clicking the card opens the full text with the same actions. Deleting asks for confirmation and removes the file, so only Git can bring it back. Each message is `messages/<slug>.md`; the slug comes from the first title and does not change when the title is edited. The text is copied exactly as written, without Markdown rendering.

## Persistence and local operation

The API detects stale edits using content hashes and saves files with atomic replacement. Application notes and unrelated YAML fields are preserved; timeline events are appended. No Git commits are made automatically. Writes to a CV and its application reference include rollback on ordinary failures; they are not a crash-proof transaction across two files.

Use **Reload files**, reload a CV from disk, or return focus to the window to refresh application data after external edits. Conflicting saves are rejected so you can reload and reconcile changes. CVs load when their management page opens.

The backend is intended for a single local user. Production binds to `127.0.0.1` and rejects cross-origin API access. Do not expose it publicly without adding authentication and deployment hardening. `vite preview` previews only static assets; use `npm start` for the working production app.

API routes: `GET /api/applications`, `POST /api/applications`, `GET /api/applications/:slug`, `PATCH /api/applications/:slug`, `DELETE /api/applications/:slug`, `PATCH /api/applications/:slug/status`, `POST /api/applications/:slug/notes`, `PUT /api/applications/:slug/job-description`, `GET /api/cvs`, `GET /api/cvs/:name`, `POST /api/cvs`, `PUT /api/cvs/:name`, `POST /api/applications/:slug/cv`, `GET /api/messages`, `POST /api/messages`, `PUT /api/messages/:slug`, `DELETE /api/messages/:slug`, `GET`/`PUT /api/settings`, `GET /api/models/:provider` and `POST /api/extract`. Mutation requests use JSON and include revisions for existing files.
