# PRISM Review Orchestrator — Design Specification

Date: 2026-09-25  
Status: Draft for final review

## 1. Purpose

PRISM is an AI-assisted review orchestration and governance platform for software teams. It does not review code or compete with tools such as PR-Agent. Instead, it decides how each pull request should be reviewed, assigns the required review path, and records why the decision was made.

The project is a portfolio demo for the Bosch Japan VM/EBE1-JP internship. It demonstrates:

- TypeScript and React web development;
- relational SQL data modeling;
- GitHub-centered team workflows;
- converting a business-unit need into a traceable web solution;
- testing, documentation, failure handling, and engineering trade-offs.

The default interface language is English.

## 2. Product Boundary

### PRISM owns

- pull-request intake and normalization;
- multi-dimensional semantic risk assessment with Jev;
- deterministic signals such as CI state, changed-file count, and sensitive paths;
- policy-based routing into review lanes;
- reviewer requirements and suggested assignments;
- human overrides with mandatory reasons;
- policy versioning, audit history, and portfolio-level visibility.

### PRISM does not own

- line-by-line code review;
- code generation or remediation;
- vulnerability scanning;
- real merge execution in the MVP;
- replacing GitHub branch protection, CI, CODEOWNERS, PR-Agent, or Qodo.

PRISM may select an external reviewer such as PR-Agent as a downstream step in a route.

## 3. Users and Primary Jobs

### Engineering lead

Needs to see risky changes across repositories, understand why they were escalated, and ensure that scarce reviewers are assigned to the right work.

### Developer

Needs to know which review path a PR entered, what evidence caused the decision, and what must happen before the PR can proceed.

### Process owner

Needs to adjust routing thresholds, preview their impact, publish versioned policies, and audit manual overrides.

## 4. Core User Experience

### 4.1 Command Center

The landing page is a horizontal Kanban with five lanes:

1. Incoming
2. Fast lane
3. Standard
4. Critical
5. Needs triage

Each PR card shows only decision-relevant information:

- repository, PR number, title, and author;
- route and aggregate risk;
- confidence;
- two strongest risk dimensions;
- CI state;
- reviewer requirement and SLA.

The primary action is `Run triage`. While assessment is running, the card shows a single pending state. When the decision returns, the card moves to its route and briefly highlights the reason for the movement. Reduced-motion preferences disable the movement animation.

### 4.2 Pull Request Detail

The detail view contains:

- a five-axis risk radar;
- the probability distribution and confidence for each Jev score;
- deterministic evidence used by the policy engine;
- a plain-language decision trace;
- required and suggested reviewers;
- downstream review steps;
- human override controls;
- an immutable audit timeline.

The five semantic dimensions are:

1. change scope;
2. business criticality;
3. test insufficiency;
4. rollback difficulty;
5. security and dependency exposure.

Each Jev `Score` assesses exactly one dimension using concrete ordered criteria. The aggregate risk is computed in application code rather than requested from the model.

### 4.3 Policy Simulator

The simulator shows the currently published policy and allows a process owner to change thresholds in a draft. Before publication, it reruns stored assessment results through the deterministic policy engine and shows:

- how many PRs would change lanes;
- which PRs would become more or less restricted;
- the resulting reviewer demand.

Publishing creates a new immutable `PolicyVersion`. It never rewrites historical decisions.

### 4.4 Audit View

The audit view filters events by repository, PR, route, actor, event type, and date. It explains changes such as evaluation completion, routing, assignment, override, and policy publication.

## 5. Demonstration Scenario

The seed dataset represents a fictional mobility software organization and does not claim to model Bosch internal systems.

| Repository | Example change | Expected route |
| --- | --- | --- |
| `dealer-portal` | CSS spacing adjustment | Fast lane |
| `diagnostic-gateway` | Vehicle diagnostic state-machine change | Critical |
| `plant-telemetry` | Production database migration and ingestion change | Critical |
| `vehicle-configurator` | Dependency update with ambiguous impact | Needs triage |
| `service-booking` | Form validation change | Standard |

The main demo begins with these PRs in Incoming. Running triage demonstrates one low-risk move, one critical escalation, and one low-confidence manual-triage result.

## 6. System Architecture

PRISM is a TypeScript monorepo managed with pnpm workspaces.

```text
apps/web (React + Vite)
        |
        | HTTP/JSON
        v
apps/api (Fastify) -------- OpenRouter Decisions API
        |                    typesafe/jev-1.13
        v
PostgreSQL

packages/risk-engine   pure routing and aggregation logic
packages/shared        shared schemas and domain types
```

### 6.1 Web application

- React and TypeScript;
- Vite for development and production builds;
- TanStack Query for server state;
- React Router for navigation;
- Recharts for the radar and probability charts;
- accessible native controls and visible keyboard focus.

### 6.2 API service

- Fastify and TypeScript;
- Zod validation at every external boundary;
- routes for PRs, assessments, policies, reviewers, and audit events;
- server-only OpenRouter credentials;
- structured error responses with stable error codes.

### 6.3 Database

- PostgreSQL started through Docker Compose;
- Drizzle ORM with inspectable SQL migrations;
- deterministic seed data;
- transactions around assessment persistence and routing decisions.

### 6.4 Risk engine

The risk engine is a pure TypeScript package. It accepts normalized evidence, dimension scores, confidence values, and a policy. It returns a route, requirements, and a trace. It has no network, database, or UI dependency.

This boundary makes routing reproducible and independently testable.

## 7. OpenRouter and Jev Integration

PRISM calls the OpenRouter Decisions API with the pinned model:

```text
typesafe/jev-1.13
```

The request contains only evidence relevant to the five semantic questions. The adapter validates the response before it reaches the risk engine.

Environment variables:

```dotenv
OPENROUTER_API_KEY=
JEV_MODEL=typesafe/jev-1.13
DATABASE_URL=postgresql://prism:prism@localhost:5432/prism
AI_PROVIDER=openrouter
```

The local `.env` is ignored by Git. A committed `.env.example` contains empty or non-secret values.

### Demo provider

When `AI_PROVIDER=demo`, the API uses deterministic fixtures that implement the same adapter interface as OpenRouter. The interface displays a persistent `Demo assessment` marker so fixture output cannot be mistaken for a live model result.

The application must not silently fall back from OpenRouter to demo mode. A live-provider failure produces Needs triage.

## 8. Decision Model

### 8.1 Inputs

Semantic inputs include title, description, normalized changed paths, code-area metadata, and declared rollback information.

Deterministic inputs include:

- number of files and lines changed;
- test and CI results;
- presence of database migrations;
- match against sensitive paths;
- CODEOWNER coverage;
- repository criticality;
- reviewer availability and skills.

### 8.2 Aggregation

Each dimension is normalized to a 0–10 value. The policy contains weights, route thresholds, confidence thresholds, and mandatory guardrails.

The weighted risk is informative, not sufficient by itself. Guardrails can always escalate a route. Examples:

- a failed required CI check cannot enter Fast lane;
- a sensitive state-machine path requires Critical;
- confidence below the policy threshold requires Needs triage;
- a database migration requires at least Standard;
- missing required ownership requires Needs triage.

### 8.3 Outputs

A routing decision contains:

- selected route;
- aggregate risk;
- policy version;
- ordered reasons;
- reviewer count and skills required;
- downstream steps;
- whether the PR is eligible for auto-merge.

Eligibility is only a recommendation in the MVP. PRISM does not merge a PR.

## 9. Relational Data Model

### Core entities

- `repositories`: repository identity, criticality, and provider metadata;
- `pull_requests`: normalized PR metadata and current lifecycle state;
- `risk_assessments`: provider, model, request state hash, aggregate result, status, and timestamps;
- `dimension_scores`: dimension, score, confidence, criteria legend, and probabilities;
- `policy_versions`: immutable policy JSON, version, author, and publication time;
- `routing_decisions`: route, trace, requirements, policy and assessment references;
- `reviewers`: identity, capacity, and availability;
- `reviewer_skills`: reviewer-to-skill many-to-many relationship;
- `review_assignments`: PR-to-reviewer relationship, role, status, and timestamps;
- `audit_events`: append-only actor, event type, entity reference, and structured details.

### Integrity rules

- every routing decision references one assessment and one policy version;
- a dimension is unique within an assessment;
- published policy versions are immutable;
- overrides append a new routing decision rather than editing the previous decision;
- audit events are never updated or deleted by application flows;
- probability and confidence values are range-checked.

## 10. API Surface

The MVP exposes:

- `GET /api/pull-requests`
- `GET /api/pull-requests/:id`
- `POST /api/pull-requests/:id/assessments`
- `POST /api/pull-requests/:id/overrides`
- `GET /api/policies/current`
- `POST /api/policies/simulate`
- `POST /api/policies`
- `GET /api/reviewers`
- `GET /api/audit-events`
- `GET /health`

Mutation endpoints accept an idempotency key. Assessment requests for the same PR revision and policy return the existing result rather than creating duplicates.

## 11. Failure and Safety Behavior

- Missing OpenRouter credentials fail API startup only in live-provider mode.
- Jev timeout, provider error, or invalid output records a failed assessment and routes the PR to Needs triage.
- Database failures do not emit a partially persisted decision.
- Repeated assessment clicks are idempotent.
- Human overrides require a non-empty reason and create an audit event.
- A policy simulation cannot publish by accident; simulation and publication are separate actions.
- UI errors state what failed and offer a relevant retry or navigation action.
- Secrets and raw authorization headers are never logged.

## 12. Visual Direction

The product should feel like an engineering control room rather than a generic SaaS dashboard.

- dark graphite navigation and work surface;
- restrained industrial blue for normal operation;
- green, amber, red, and violet reserved for route state;
- square or lightly rounded geometry rather than pill-heavy cards;
- tabular numeric typography for scores and probabilities;
- dense but legible layouts optimized for laptop screens;
- motion used only for the triage-to-lane transition and direct interaction feedback.

The radar is the single expressive visual element. Other surfaces remain quiet and operational.

## 13. Testing Strategy

### Unit tests

- score normalization and weighting;
- every route threshold and guardrail;
- confidence handling;
- reviewer eligibility and load ordering;
- policy simulation diffing.

### Integration tests

- API validation and stable errors;
- assessment transaction and idempotency;
- OpenRouter adapter with recorded contract fixtures;
- database constraints and migrations;
- policy publication and immutable history.

### End-to-end tests

- a low-risk PR moves from Incoming to Fast lane;
- a sensitive state-machine change moves to Critical;
- a low-confidence result moves to Needs triage;
- an override requires a reason and appears in the audit timeline;
- changing thresholds in simulation does not mutate the published policy.

### Quality gates

- TypeScript type checking;
- linting and formatting;
- unit and integration test suites;
- production build;
- Playwright critical-path suite;
- no committed secrets.

## 14. Documentation and Portfolio Presentation

The repository README will include:

- the business problem and product boundary;
- a comparison with PR-Agent;
- architecture and ER diagrams;
- screenshots or a short demo GIF;
- setup using demo mode and live OpenRouter mode;
- test commands;
- safety decisions and known limitations;
- future GitHub webhook and downstream-review integrations.

The demo must be usable without GitHub authorization. GitHub webhook ingestion is represented by normalized seeded PRs and a local intake endpoint; a production GitHub App is explicitly future work.

## 15. MVP Exclusions

- production authentication and multi-tenancy;
- actual GitHub App installation;
- real merge or approval mutations;
- learning policies from historical outcomes;
- notification integrations;
- generating code-review comments;
- mobile-first layouts;
- deployment infrastructure beyond local Docker Compose.

These exclusions keep the project focused on the internship-relevant web, SQL, collaboration, and business-solution skills.

## 16. Acceptance Criteria

The MVP is complete when:

1. a fresh checkout can start in demo mode using documented commands;
2. seeded PRs appear in Incoming and can be triaged;
3. the expected low-risk, critical, and uncertain examples reach the correct lanes;
4. a PR detail view explains scores, evidence, policy trace, and audit history;
5. a policy can be simulated and published as a new version;
6. a routing decision can be manually overridden with a reason;
7. the OpenRouter adapter can call `typesafe/jev-1.13` when a key is supplied;
8. provider failure safely results in Needs triage;
9. automated tests cover the core routing and safety behavior;
10. the README clearly distinguishes PRISM from PR-Agent.
