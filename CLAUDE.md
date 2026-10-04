# Career Assistant — instructions for agents

## Source of truth

**PostgreSQL is the only source of domain data.** The legacy Markdown folders were imported and removed; their exact text lives in `import_sources` and Git history.

- Use the local API or transactional domain operations in `server/postgres-store.ts`.
- Markdown remains content stored in PostgreSQL `TEXT`, not a second writable source of truth.
- `.env` holds deployment configuration and AI credentials. Never expose credentials to the browser or tool output.
- Git tracks code only. PostgreSQL and external files need their own backups.

## Architecture

React → Node HTTP API → transactional domain operations → PostgreSQL.

- Schema: `server/db/migrations/`.
- PostgreSQL connection and transaction helper: `server/db/connection.ts`.
- Explicit migration runner: `server/db/migrate.ts`.
- Shared schemas and parsers: `dashboard/src/domain/`.
- `server/store.ts`: shared `StoreError`/`revision` and guarded file access for `.env` and static assets only.

## Domain rules

- All persistent domain entities and associations use UUIDs, `created_at`, `updated_at`, `deleted_at`.
- Normal reads filter removed records and removed owning parents. Never physically delete domain data in normal operations.
- Application removal hides children through the parent. Restoration must not revive individually removed children.
- Status `archived` is a business status, distinct from soft delete.
- Slugs remain reserved after removal; they are labels/routes, not identity.
- Monetary values use exact decimal strings across the API and `NUMERIC(19,4)` in PostgreSQL. Do not convert through `Number`.
- Calendar dates use `DATE`; known instants use `TIMESTAMPTZ`. Never invent midnight for a legacy date. Use explicit `APP_TIMEZONE` for today/overdue calculations.
- Mutable operations reject stale `row_version` revisions.
- Status change, history event and related task changes form one transaction.
- Preserve notes; append rather than replacing existing application notes.
- Timeline events are immutable. Correct history with a new event.
- CV edits create immutable versions. Derivations reference exact source versions.
- CV selection does not prove submission. Record actual submissions separately; preserve all previous sent versions.
- Do not invent experience, qualifications or derivation/submission provenance. Start from the master CV's actual facts.
- Participants preserve their recorded display name/role even if the linked contact changes.
- Preserve raw transcripts. AI analyses are separate immutable results.
- Binary files stay outside PostgreSQL; store durable references and metadata.

## Migration and changes

- Never modify an applied migration. Add a new migration.
- Migrations are explicit commands, never automatic startup actions.
- Do not add multi-tenancy, users or additional databases/caches without a concrete request.
- Do not commit unless asked.

## Commands

```bash
npm run dev
npm run build
npm test
npm run db:migrate
npm run db:export -- --output ./exports/<new-dir>
```

Integration tests require `TEST_DATABASE_URL`; they create and remove isolated test schemas. Run relevant PostgreSQL tests after persistence/schema changes. See README for local Docker setup and API routes.
