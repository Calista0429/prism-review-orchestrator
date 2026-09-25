import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import type {
  Dimension,
  DimensionScore,
  Evidence,
  Policy,
  Route,
  RoutingResult,
} from '@prism/shared';
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow();
export const repositories = pgTable('repositories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  criticality: text('criticality').notNull(),
});
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    author: text('author').notNull(),
    revision: text('revision').notNull(),
    evidence: jsonb('evidence').$type<Evidence>().notNull(),
    createdAt: time('created_at'),
  },
  (t) => [unique().on(t.repositoryId, t.number)],
);
export const policyVersions = pgTable('policy_versions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().unique(),
  policy: jsonb('policy').$type<Policy>().notNull(),
  author: text('author').notNull(),
  publishedAt: time('published_at'),
});
export const riskAssessments = pgTable('risk_assessments', {
  id: text('id').primaryKey(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .references(() => pullRequests.id),
  policyVersionId: text('policy_version_id')
    .notNull()
    .references(() => policyVersions.id),
  provider: text('provider').$type<'demo' | 'openrouter'>().notNull(),
  model: text('model').notNull(),
  requestedModel: text('requested_model').notNull(),
  status: text('status').$type<'completed' | 'failed'>().notNull(),
  stateHash: text('state_hash').notNull(),
  aggregateRisk: real('aggregate_risk'),
  errorCode: text('error_code'),
  createdAt: time('created_at'),
  sequence: integer('sequence').generatedAlwaysAsIdentity(),
});
export const dimensionScores = pgTable(
  'dimension_scores',
  {
    assessmentId: text('assessment_id')
      .notNull()
      .references(() => riskAssessments.id),
    dimension: text('dimension').$type<Dimension>().notNull(),
    score: real('score').notNull(),
    confidence: real('confidence').notNull(),
    criteria: jsonb('criteria').$type<DimensionScore['criteria']>().notNull(),
    probabilities: jsonb('probabilities').$type<number[]>().notNull(),
  },
  (t) => [unique().on(t.assessmentId, t.dimension)],
);
export const routingDecisions = pgTable('routing_decisions', {
  id: text('id').primaryKey(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .references(() => pullRequests.id),
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => riskAssessments.id),
  policyVersionId: text('policy_version_id')
    .notNull()
    .references(() => policyVersions.id),
  route: text('route').$type<Route>().notNull(),
  result: jsonb('result').$type<RoutingResult>().notNull(),
  kind: text('kind').$type<'assessment' | 'override'>().notNull(),
  actor: text('actor').notNull(),
  overrideReason: text('override_reason'),
  createdAt: time('created_at'),
  sequence: integer('sequence').generatedAlwaysAsIdentity(),
});
export const reviewers = pgTable('reviewers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  capacity: integer('capacity').notNull(),
  available: boolean('available').notNull(),
});
export const reviewerSkills = pgTable(
  'reviewer_skills',
  {
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => reviewers.id),
    skill: text('skill').notNull(),
  },
  (t) => [unique().on(t.reviewerId, t.skill)],
);
export const reviewAssignments = pgTable('review_assignments', {
  id: text('id').primaryKey(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .references(() => pullRequests.id),
  reviewerId: text('reviewer_id')
    .notNull()
    .references(() => reviewers.id),
  status: text('status').notNull(),
  role: text('role').notNull(),
  createdAt: time('created_at'),
});
export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  actor: text('actor').notNull(),
  pullRequestId: text('pull_request_id').references(() => pullRequests.id),
  repository: text('repository'),
  route: text('route').$type<Route>(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull(),
  createdAt: time('created_at'),
  sequence: integer('sequence').generatedAlwaysAsIdentity(),
});
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  requestHash: text('request_hash').notNull(),
  response: jsonb('response').$type<unknown>().notNull(),
  createdAt: time('created_at'),
});
