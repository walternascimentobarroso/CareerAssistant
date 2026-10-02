# Career Assistant

A personal, Markdown-first tracker for a job search: applications, job descriptions, CVs, interviews, next actions and history, all as plain files in a Git repository, with a small read-only dashboard on top.

## Philosophy

```text
Markdown = DATA
Git      = HISTORY
React    = VIEW
AI       = ASSISTANT
```

- The Markdown files are the only source of truth. There is no database.
- The dashboard only reads. Delete `dashboard/` tomorrow and every piece of data is still usable.
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

Vite bundles the Markdown files into the dashboard (`import.meta.glob`), so there is no backend. `npm run validate` uses the same parser and schema from Node.

## Installation

Requires Node.js 22 or newer.

```bash
npm install
```

## Development

```bash
npm run dev        # dashboard at http://localhost:5173, reloads when a Markdown file changes
npm run validate   # check every application
npm run build      # type-check and build the static dashboard into dist/
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
dashboard/                  React view
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

To move a card or complete a task, edit `application.md`. Applications with invalid Markdown are hidden and listed in a banner at the top with the reason.

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
- Drag-and-drop on the board and completing tasks from the dashboard (requires writing files)
- History of completed actions
- Integrations: calendar, email, transcription, job boards, AI APIs
