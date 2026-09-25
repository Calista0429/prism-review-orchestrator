# PRISM — review orchestration for pull requests

A local demo that helps engineering teams **choose the review path, identify the required expertise, and explain each decision**.
Jev assesses five semantic risk dimensions; TypeScript rules combine those scores with CI, ownership and path evidence.
The workflow is _PR evidence → risk assessment → policy-based routing → review requirements + audit history_.

![Architecture: React calls a Fastify service; an assessment adapter obtains Jev or demo scores; deterministic rules select a review path; Drizzle persists decisions and audit history](docs/architecture/prism-architecture.svg)

<sub>Source: [SVG](docs/architecture/prism-architecture.svg) · [HTML with PNG/PDF export](docs/architecture/prism-architecture.html), drawn with the [architecture-diagram skill](https://github.com/Cocoon-AI/architecture-diagram-generator) (MIT). The HTML export toolbar loads pinned CDN libraries.</sub>

## Usage scenarios

These are workplace role-plays backed by an isolated API rehearsal: the five seeded PRs were assessed with the **fixed demo provider**, followed by policy simulation, a manual override and policy publication.
The result excerpts below summarize those responses; they are not transcripts of a live agent conversation or measured productivity gains.
Live Jev scores can differ. The scenarios model a fictional mobility software team, not Bosch internal systems.

| #                                              | Scenario                               | Who                          | What it shows                                                                |
| ---------------------------------------------- | -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| [1](#1-small-changes-without-repeated-triage)  | Small changes without repeated triage  | developer + engineering lead | evidence → Fast lane, with CI and branch-protection checks still required    |
| [2](#2-finding-the-right-reviewers)            | Finding the right reviewers            | engineering lead             | migration risk → required skills → eligible reviewer suggestions             |
| [3](#3-consistent-review-standards)            | Consistent review standards            | on-call lead                 | sensitive changes receive stricter requirements regardless of who is on duty |
| [4](#4-making-uncertainty-actionable)          | Making uncertainty actionable          | developer + triage owner     | low confidence → human triage and a focused evidence request                 |
| [5](#5-previewing-the-cost-of-a-policy-change) | Previewing the cost of a policy change | process owner                | stored scores → draft simulation → reviewer demand before publication        |
| [6](#6-explaining-a-human-override)            | Explaining a human override            | release owner                | reasoned override → new decision → preserved audit trail                     |

![PRISM command center with incoming and assessed pull requests](docs/screenshots/prism-command-center.png)

### 1. Small changes without repeated triage

Maya asks whether a spacing-only change needs the same review process as a database migration.
The lead clicks **Run triage** on `dealer-portal #142`, then opens **Decision trace**.
Two changed files, passing CI, complete ownership coverage and a simple revert support a lightweight path.

```text
dealer-portal #142
risk: 0.50 / 10   minimum confidence: 97%
route: Fast lane
reviewers required by PRISM: 0
next steps: passing CI; check branch protection before merge
```

The developer can see the requirements without repeatedly asking the lead.
Zero means PRISM adds no human-review requirement; repository protections still apply. The demo does not approve or merge the PR.

### 2. Finding the right reviewers

Lena's `plant-telemetry #231` partitions a production events table; recovery requires a snapshot restore and event replay.
The lead opens **Review requirements → Suggested reviewers** instead of asking the whole team who understands the change.

```text
route: Critical   risk: 6.88 / 10
required: 2 reviewers with domain + database skills
suggested: Aya Tanaka, Daniel Fischer
```

Suggestions exclude the author, unavailable reviewers and people at capacity, then rank by existing load relative to capacity.
The lead still confirms availability and assigns work in the team's actual collaboration tools.
Suggestions neither create assignments nor reserve capacity, so the same person can appear on several PRs.

### 3. Consistent review standards

Kenji asks whether passing tests are enough to treat a diagnostic state-machine change as routine.
The on-call lead compares `diagnostic-gateway #87` with the booking-form validation change in `service-booking #109`.

```text
diagnostic-gateway #87 → Critical   risk: 7.13 / 10   2 domain reviewers
service-booking #109   → Standard   risk: 4.13 / 10   1 general reviewer
```

The diagnostic PR touches a sensitive path in a safety-critical repository, which requires Critical review.
The lead can point to the same policy and evidence on every shift instead of renegotiating the standard.
If confidence or ownership is insufficient, a Critical change goes to human triage while retaining its stricter reviewer requirements.

### 4. Making uncertainty actionable

Alex upgrades a configuration dependency whose release notes do not explain a precedence change.
The lead opens `vehicle-configurator #56` and checks the confidence values and CI evidence.

```text
risk: 5.63 / 10
minimum confidence: 43%   policy minimum: 75%
CI: pending
route: Needs triage
```

The next conversation is specific: establish compatibility, add precedence tests and wait for CI.
Other PRs can continue through their own lanes. Provider failures also require triage; there is no silent fallback to demo scores.
Evidence editing and revision webhooks are not implemented, so this scenario ends with an identified follow-up, not an automated resolution.

### 5. Previewing the cost of a policy change

Before any override or new policy publication, the process owner opens **Policy simulator** and lowers **Critical threshold** from 6 to 4.
Keep **Fast lane threshold** at 3 and **Minimum confidence** at 0.75, then click **Simulate draft**.

```text
assessed PRs: 5
lane changes: 1   service-booking: Standard → Critical
required reviewer slots: 6 → 8
new lane counts: Fast 1 / Standard 0 / Critical 3 / Needs triage 1
```

Only one PR changes lanes, but two reviewer slots are added: booking needs another reviewer, and configurator retains a two-reviewer Critical requirement while staying in triage.
The preview helps the owner discuss workload before changing policy. Slots are summed across PRs, not a count of distinct employees or a scheduling forecast.

Simulation reuses stored scores, makes no model call and leaves current decisions unchanged.
**Publish policy** creates v2; existing decisions retain v1 until a new decision is recorded.
For the next scenario, leave this as a preview without publishing.

### 6. Explaining a human override

The release owner requests additional domain review of booking validation before a seasonal launch.
In `service-booking #109`, select **Manual override → Critical**, enter the reason, and click **Apply override**.
Then filter **Audit trail** by **PR ID** = `pr-booking` and **Event type** = `override`.

```text
previous route: Standard   new route: Critical
reason: Workshop scenario: release owner requests domain review of
        appointment validation before the seasonal launch.
actor: demo-operator
required: 2 reviewers; general + domain skills
auto-merge eligible: false
original assessment and routing history: retained
```

A later reviewer can reconstruct the decision without searching chat history.
The UI uses `demo-operator`; there is no login system, so the actor field is not verified employee identity.

For a complete role-play, baseline scores, expected outcomes and ways to measure the benefit, see the [中文工作案例与演练手册](docs/workplace-cases.md).
That guide retains the earlier case numbering; its policy simulation comes before its override when reproducing the baseline.
A real pilot should compare triage time, time to first substantive review, routing corrections and traceability, alongside missed reviews and defects. This demo does not yet measure those outcomes.

## Quick start

Requires Node.js 22+ and pnpm 11.19.0; CI uses Node.js 24.

```sh
pnpm install
cp -n .env.example .env      # create only if .env does not already exist
pnpm dev                    # migrations + missing fixtures; preserves history
```

Open [the command center](http://127.0.0.1:5173). Fastify listens on `127.0.0.1:3001`; Vite proxies `/api` and `/health`.
The example configuration uses fixed demo scores and **PGlite**, an embedded PostgreSQL engine persisted at `.data/prism`.
No Docker, API key or GitHub authorization is needed in that mode. Only one API process should open that embedded database.

To reproduce all six scenarios from a clean baseline, stop the existing development server and run:

```sh
AI_PROVIDER=demo DATABASE_URL=pglite:memory pnpm dev
```

Assess all five cards with **Run triage** before the policy simulation. This command leaves `.env` and persistent history unchanged.
After the rehearsal, stop the server and use ordinary `pnpm dev` to restore the configured mode and database.

### Use a real model

Set these values in the root `.env` and restart the API:

```dotenv
AI_PROVIDER=openrouter
JEV_MODEL=typesafe/jev-1.13
OPENROUTER_API_KEY=your-key
```

The adapter calls the [OpenRouter Decisions API](https://openrouter.ai/blog/tutorials/how-to-use-jev/) with five score questions, not a chat-completion prompt.
It validates the criteria, fractional scores, confidence and probabilities, then maps 0–4 scores to 0–10.
The key stays on the server; PR titles, descriptions and normalized evidence are sent in live mode.
Missing credentials fail startup; HTTP errors, invalid output and the 15-second timeout produce a failed assessment and human triage.

The live path was separately verified on `dealer-portal #142`: the returned model was `typesafe/jev-1.13-20260917`, weighted risk was 0.14/10, minimum confidence was 90%, and the route was Fast lane.
That is one observed run, not the fixed score used in the scenarios or a model-quality benchmark.
Demo scores exist only for the five seeded PRs; custom intake in demo mode produces `DEMO_FIXTURE_NOT_FOUND` and Needs triage.

### Use a PostgreSQL server

```sh
docker compose up -d --wait
```

Set `DATABASE_URL=postgresql://prism:prism@localhost:5432/prism` in `.env`, then run `pnpm dev`.
Both database options use the same SQL migration and Drizzle queries.
`pnpm db:migrate` and `pnpm db:seed` can also be run explicitly; they preserve existing history.

## What the demo shows

| Scenario                                      | Mechanism                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Low-risk change takes a lightweight path      | five weighted dimensions, thresholds and evidence guardrails                     |
| Sensitive change requires expertise           | sensitive paths / safety criticality → Critical; skill and capacity filtering    |
| Uncertain or failed assessment needs a person | weakest-dimension confidence, owner coverage and provider-failure handling       |
| A mutation is retried with the same key       | API stores and replays the response; different content with that key returns 409 |
| Human changes the review path                 | reason required; new decision preserves history and reviewer obligations         |
| Process owner tries stricter thresholds       | simulation reuses stored scores; publication creates a policy version            |
| Assessment and history must agree             | scores, decision, audit and idempotency response commit in one transaction       |

The model supplies bounded risk estimates; application code selects the review path.
PRISM can recommend PR-Agent as a downstream review step, but does not invoke it.
It does not generate fixes, scan for vulnerabilities, replace code review or execute approvals and merges.

## Design decisions (and their trade-offs)

- **Model scores, deterministic decisions.** The engine weights scope, criticality, test insufficiency, rollback difficulty and security exposure at 20/25/20/15/20%.
  Default thresholds are 3 and 6, with a 75% confidence floor. Hard evidence can increase the review requirements.
  These are illustrative policies; confidence is not a calibrated probability that a change is safe.
- **A synchronous transaction for each mutation.** Advisory/row locks, successful-assessment deduplication and persisted idempotency responses keep history consistent.
  The provider call happens inside the assessment transaction; slow inference holds it open. A production service would need queued work and a concurrency design.
- **History is append-only.** Policies, assessments, scores, decisions and audit events are protected by database triggers.
  Overrides append records and disable auto-merge eligibility. Policy publication uses `baseVersion` to detect stale drafts.
  Retention, pagination and deletion governance are future work.
- **Embedded SQL for local setup.** PGlite removes the Docker requirement while preserving PostgreSQL semantics for the demo and tests.
  It is opened by a single API process; embedded tests do not establish production PostgreSQL load or concurrency behavior.
- **Recommendations leave execution to people.** Reviewer suggestions use skills, availability and existing load, but do not assign work or send messages.
  This makes the decision visible without pretending to run the entire review workflow.
- **Known gaps.** No authentication, verified actor identities, GitHub App, revision webhooks, trusted CI/CODEOWNERS ingestion, downstream execution or multi-tenant authorization.
  Local intake accepts supplied evidence. Do not expose this demo as a production governance service.

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

Unit tests cover routing and reviewer rules; integration tests use in-memory PGlite for transactions, immutable history and provider failures.
Provider contract tests use synthetic responses. Playwright starts an isolated demo on ports 3001/5173, so stop an existing development server first.
`pnpm build` bundles the frontend and type-checks the API; run the API with `pnpm --filter @prism/api start`.

## Layout

```text
apps/web/src/pages/        board, PR details, policy simulator, audit
apps/web/src/api.ts        HTTP client and query/mutation hooks
apps/api/src/app.ts        Fastify endpoints and request validation
apps/api/src/service.ts    transactional assessment, overrides, policy changes
apps/api/src/providers.ts  OpenRouter Decisions adapter and fixed demo provider
apps/api/src/queries.ts    decisions, history and reviewer suggestions
apps/api/src/db/           Drizzle schema, connections, migrations and fixtures
apps/api/migrations/       PostgreSQL SQL and immutable-history constraints
packages/shared/          domain types and Zod contracts
packages/risk-engine/     weighted routing, guardrails, reviewer rules, simulation
tests/e2e/                Playwright workflow checks
docs/architecture/        SVG diagram and exportable HTML
docs/workplace-cases.md    detailed Chinese role-play and benefit-validation guide
docs/technical-reference.md  API routes, routing rules and data relationships
```

See the [technical reference](docs/technical-reference.md), [design specification](docs/superpowers/specs/2026-09-25-prism-design.md) and [implementation plan](docs/superpowers/plans/2026-09-25-prism-mvp.md).
