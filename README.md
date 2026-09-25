# PRISM

**Put every pull request on the right review path.**

PRISM is a review orchestration demo for a fictional mobility software organization. It combines five semantic risk scores with deterministic evidence, applies a versioned policy, and explains why a change needs a particular review path.

The engineering lead sees what needs attention. Developers see the evidence and reviewer requirements. Process owners can simulate policies and record reasoned overrides without erasing past decisions.

This portfolio project demonstrates TypeScript/React development, relational SQL modeling, API boundaries, reproducible business rules, and failure handling. It does not model Bosch internal systems.

## Run the demo

Requires Node.js 22 or later and pnpm 11.19.0. Node.js 24 is used in CI.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open [the command center](http://127.0.0.1:5173). The API listens on `127.0.0.1:3001`. Startup applies migrations and inserts missing demo fixtures; restarting does not reset review history. No API key or GitHub authorization is needed.

The default `DATABASE_URL=pglite:./.data/prism` uses **PGlite, an embedded PostgreSQL engine**, and persists data under the repository's `.data/prism` directory. It runs the same SQL migration and Drizzle queries as the PostgreSQL server option. Only one API process should open that embedded database at a time. Tests use isolated in-memory databases.

For an empty temporary demo without deleting your local history:

```sh
DATABASE_URL=pglite:memory pnpm dev
```

### PostgreSQL through Docker

```sh
docker compose up -d --wait
```

Set `DATABASE_URL=postgresql://prism:prism@localhost:5432/prism` in `.env`, then run `pnpm dev`. Compose publishes the database only on loopback. Both database commands below are safe to repeat and preserve existing records:

```sh
pnpm db:migrate
pnpm db:seed
```

### Live Jev assessments

Set these values in the root `.env`, then restart the API:

```dotenv
AI_PROVIDER=openrouter
JEV_MODEL=typesafe/jev-1.13
OPENROUTER_API_KEY=your-key
```

The key stays on the API server. PR metadata, descriptions and normalized evidence are sent to OpenRouter only in live mode. Missing credentials fail startup. Timeout, HTTP errors and invalid model output produce a failed assessment and **Needs triage**; the app never silently switches to demo scores.

The adapter calls the [OpenRouter Decisions API](https://openrouter.ai/blog/tutorials/how-to-use-jev/) with five independent `score` questions. It validates the criteria legend, fractional score range, confidence and complete probability distribution before normalizing each 0–4 score to 0–10. Rounded provider probabilities are normalized before storage. The selected model is [TypeSafe Jev 1.13](https://openrouter.ai/typesafe/jev-1.13). Provider requests have a 15-second timeout. Contract tests use synthetic responses matching the documented format, not a recorded paid live call.

Demo fixtures are explicitly identified in the UI and API. Demo scores exist only for the five seeded PRs; a custom local intake in demo mode routes to Needs triage with `DEMO_FIXTURE_NOT_FOUND`. Use live mode to assess arbitrary intake.

## Demo walkthrough

All five PRs initially appear in Incoming. Click **Run triage** on a card.

![PRISM command center](docs/screenshots/prism-command-center.png)

| Repository           | Change                        | Expected route |
| -------------------- | ----------------------------- | -------------- |
| dealer-portal        | Visual spacing                | Fast lane      |
| diagnostic-gateway   | Diagnostic state machine      | Critical       |
| plant-telemetry      | Production database migration | Critical       |
| vehicle-configurator | Ambiguous dependency update   | Needs triage   |
| service-booking      | Form validation               | Standard       |

Open a PR to inspect its five-axis radar, probabilities and criteria, CI/path/ownership evidence, reviewer requirements, suggested reviewers, policy trace and audit history. An override requires a reason and appends a new decision. Override decisions never recommend auto-merge and preserve existing reviewer obligations.

In **Policy simulator**, adjust thresholds, simulate stored assessments and compare lane changes and reviewer demand. Editing the draft invalidates the preview. **Publish policy** is a separate action that creates a version; historical decisions keep their original policy references. The audit page supports repository, PR, route, actor, event type and date filters.

## How routing works

Five semantic dimensions are weighted in application code:

| Dimension                        | Default weight |
| -------------------------------- | -------------- |
| Change scope                     | 20%            |
| Business criticality             | 25%            |
| Test insufficiency               | 20%            |
| Rollback difficulty              | 15%            |
| Security and dependency exposure | 20%            |

Default thresholds are Fast lane below 3, Standard from 3 to below 6, and Critical from 6. The weakest dimension must reach 75% confidence. These are illustrative demo policy choices, not validated safety thresholds.

Guardrails run after weighted routing. CI that has not passed, migrations, and more than 30 files prohibit Fast lane. Sensitive paths and safety-critical repositories require Critical. Missing ownership, low confidence, and provider failure require human triage; Critical reviewer requirements are retained when uncertain changes enter triage. Scores are rounded for display only after the routing comparison.

Reviewer suggestions exclude the PR author, unavailable reviewers, and reviewers at capacity. Eligible reviewers have the required skills and are ordered by assigned load relative to capacity. Suggestions do not create assignments or contact anyone. Downstream PR-Agent steps are recommendations, not executed integrations.

## PRISM and PR-Agent

|              | PRISM                                                  | PR-Agent / code-review tools       |
| ------------ | ------------------------------------------------------ | ---------------------------------- |
| Primary job  | Decide the review path and requirements                | Review the code change             |
| Output       | Route, risk evidence, policy trace, governance history | Review findings and suggestions    |
| Model role   | Bounded semantic risk dimensions                       | Code analysis and explanatory text |
| Relationship | Can recommend an external review step                  | Can be a downstream reviewer       |

PRISM does not generate fixes, scan for vulnerabilities, approve or merge a PR, or replace CI, CODEOWNERS and branch protection.

## Architecture

```mermaid
flowchart LR
  Web[React + Vite] -->|HTTP / JSON| API[Fastify]
  API --> Engine[Pure TypeScript risk engine]
  API --> DB[(PostgreSQL / PGlite)]
  API --> Demo[Deterministic demo fixtures]
  API -->|Live mode only| Jev[OpenRouter Decisions / Jev]
  Shared[Shared Zod contracts] -.-> Web
  Shared -.-> API
  Shared -.-> Engine
```

```text
apps/web                command center, PR detail, policy simulator, audit
apps/api                HTTP boundaries, transactional service, providers
apps/api/migrations     inspectable PostgreSQL SQL
packages/shared         domain types and Zod schemas
packages/risk-engine    aggregation, guardrails, suggestions, simulation
tests/e2e               Playwright critical paths
```

```mermaid
erDiagram
  repositories ||--o{ pull_requests : contains
  pull_requests ||--o{ risk_assessments : assessed
  risk_assessments ||--o{ dimension_scores : scores
  policy_versions ||--o{ risk_assessments : evaluated_under
  risk_assessments ||--o{ routing_decisions : informs
  policy_versions ||--o{ routing_decisions : governs
  pull_requests ||--o{ routing_decisions : routed
  pull_requests ||--o{ audit_events : history
  reviewers ||--o{ reviewer_skills : has
  reviewers ||--o{ review_assignments : receives
  pull_requests ||--o{ review_assignments : reviewed
```

SQL checks enforce score/probability ranges; foreign keys preserve relationships. A partial unique index deduplicates successful assessment state + policy + provider/model. Failed attempts remain in history and can be retried with a new idempotency key. Triggers reject updates/deletes on policies, decisions, assessments, scores and audit history. Assessment, scores, routing, audit and the idempotency response are persisted in one transaction. Advisory/row locks serialize conflicting mutations. Published policy versions use optimistic concurrency through `baseVersion`.

## API

All mutation routes require an `Idempotency-Key` header. Reusing a key with different content returns HTTP 409; retrying an identical request returns the stored response. API failures use `{ "error": { "code": "…", "message": "…" } }`.

| Method | Route                                | Purpose                                   |
| ------ | ------------------------------------ | ----------------------------------------- |
| GET    | `/health`                            | Process and provider status               |
| GET    | `/api/pull-requests`                 | Board data                                |
| GET    | `/api/pull-requests/:id`             | Scores, decisions, reviewers and history  |
| POST   | `/api/pull-requests`                 | Local normalized intake                   |
| POST   | `/api/pull-requests/:id/assessments` | Assess and route                          |
| POST   | `/api/pull-requests/:id/overrides`   | Append a reasoned override                |
| GET    | `/api/policies/current`              | Latest published policy                   |
| POST   | `/api/policies/simulate`             | Replay stored assessments against a draft |
| POST   | `/api/policies`                      | Publish a version using `baseVersion`     |
| GET    | `/api/reviewers`                     | Skills, capacity and availability         |
| GET    | `/api/audit-events`                  | Filterable audit trail                    |

```sh
curl -X POST http://127.0.0.1:3001/api/pull-requests/pr-dealer/assessments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-dealer-first-assessment' \
  -d '{}'
```

The intake contract lives in `packages/shared/src/index.ts`: repository, PR number, title, description, author, revision and evidence are required. A repository/number pair is unique. Revision-update/webhook ingestion is future work. Sensitive state-machine/safety paths and migration paths are recognized during local intake; supplied evidence can add restrictions. A real GitHub adapter must fetch trusted CI and ownership evidence itself.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Unit tests cover risk thresholds, guardrails, confidence, reviewer eligibility and simulation. Integration tests use real PostgreSQL semantics through in-memory PGlite, including repeat/concurrent requests, atomic rollback, immutable history and provider failure. The Playwright suite starts a dedicated in-memory API and Vite server on ports 3001/5173, so stop an existing development server before running it. Browser tests never touch the persistent demo database. CI runs the same checks on Linux.

`pnpm build` creates the Vite web bundle and type-checks the API. The API runs directly with `pnpm --filter @prism/api start`; this project does not package a standalone server binary.

## Limits and next steps

- This is a local, single-organization demo with no authentication. Actor names are supplied by the caller. Do not expose it as a production governance service.
- Jev confidence is model uncertainty, not a guarantee of correctness. Human triage is required for insufficient confidence or evidence.
- No GitHub App, real webhooks, merge/approval actions, notifications or downstream review execution. Seeded changes represent intake.
- Embedded-database tests do not replace a production PostgreSQL concurrency/load suite. Docker PostgreSQL and paid live Jev calls need separate environment verification.
- The demo evaluates small datasets in memory and queries complete PR history. Pagination, retention, queued provider jobs, assignment workflows, calibrated policy thresholds and multi-tenant authorization are future work.
- Policies, override traces and idempotency records are intentionally retained. No destructive reset endpoint is exposed.

See the [design specification](docs/superpowers/specs/2026-09-25-prism-design.md) and [implementation plan](docs/superpowers/plans/2026-09-25-prism-mvp.md).
