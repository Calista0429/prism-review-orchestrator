import { z } from 'zod';

export const dimensions = [
  'scope',
  'criticality',
  'testing',
  'rollback',
  'security',
] as const;
export type Dimension = (typeof dimensions)[number];
export const dimensionLabels: Record<Dimension, string> = {
  scope: 'Change scope',
  criticality: 'Business criticality',
  testing: 'Test insufficiency',
  rollback: 'Rollback difficulty',
  security: 'Security & dependencies',
};
export const routes = ['fast', 'standard', 'critical', 'triage'] as const;
export const routeSchema = z.enum(routes);
export type Route = z.infer<typeof routeSchema>;
export const routeLabels: Record<Route | 'incoming', string> = {
  incoming: 'Incoming',
  fast: 'Fast lane',
  standard: 'Standard',
  critical: 'Critical',
  triage: 'Needs triage',
};
const probability = z.number().finite().min(0).max(1);
export const dimensionScoreSchema = z.object({
  dimension: z.enum(dimensions),
  score: z.number().finite().min(0).max(10),
  confidence: probability,
  criteria: z.array(z.string().min(1)).length(5),
  probabilities: z
    .array(probability)
    .length(5)
    .refine(
      (p) => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 0.001,
      'Probabilities must sum to 1',
    ),
});
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;
export const scoresSchema = z
  .array(dimensionScoreSchema)
  .length(5)
  .refine(
    (scores) => new Set(scores.map((s) => s.dimension)).size === 5,
    'Each dimension must occur exactly once',
  );
export const evidenceSchema = z.object({
  filesChanged: z.number().int().min(0),
  linesAdded: z.number().int().min(0),
  linesDeleted: z.number().int().min(0),
  ci: z.enum(['passed', 'failed', 'pending', 'unknown']),
  hasMigration: z.boolean(),
  sensitivePaths: z.array(z.string().min(1)).max(1000),
  ownerCoverage: z.boolean(),
  repositoryCriticality: z.enum(['normal', 'high', 'safety']),
  paths: z.array(z.string().min(1)).max(1000),
  rollback: z.string().max(4000),
});
export type Evidence = z.infer<typeof evidenceSchema>;
const weights = z
  .object({
    scope: z.number().min(0).max(1),
    criticality: z.number().min(0).max(1),
    testing: z.number().min(0).max(1),
    rollback: z.number().min(0).max(1),
    security: z.number().min(0).max(1),
  })
  .refine(
    (v) => Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 1) < 0.000001,
    'Weights must sum to 1',
  );
export const policySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    fastThreshold: z.number().min(0).max(10),
    criticalThreshold: z.number().min(0).max(10),
    confidenceThreshold: probability,
    weights,
  })
  .refine(
    (p) => p.fastThreshold < p.criticalThreshold,
    'Fast threshold must be below critical threshold',
  );
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy: Policy = {
  name: 'Mobility baseline',
  fastThreshold: 3,
  criticalThreshold: 6,
  confidenceThreshold: 0.75,
  weights: {
    scope: 0.2,
    criticality: 0.25,
    testing: 0.2,
    rollback: 0.15,
    security: 0.2,
  },
};
export interface PolicyVersion {
  id: string;
  version: number;
  policy: Policy;
  author: string;
  publishedAt: string;
}
export interface ReviewerRequirements {
  count: number;
  skills: string[];
  slaHours: number;
}
export interface RoutingResult {
  route: Route;
  aggregateRisk: number | null;
  confidence: number | null;
  reasons: string[];
  requirements: ReviewerRequirements;
  downstreamSteps: string[];
  autoMergeEligible: boolean;
}
export interface Decision extends RoutingResult {
  id: string;
  assessmentId: string;
  policyVersionId: string;
  policyVersion: number;
  kind: 'assessment' | 'override';
  actor: string;
  createdAt: string;
  overrideReason: string | null;
}
export interface Assessment {
  id: string;
  provider: 'demo' | 'openrouter';
  model: string;
  status: 'completed' | 'failed';
  stateHash: string;
  scores: DimensionScore[];
  errorCode: string | null;
  createdAt: string;
}
export interface Reviewer {
  id: string;
  name: string;
  username: string;
  skills: string[];
  capacity: number;
  activeAssignments: number;
  available: boolean;
}
export interface AuditEvent {
  id: string;
  type: string;
  actor: string;
  pullRequestId: string | null;
  repository: string | null;
  route: Route | null;
  details: Record<string, unknown>;
  createdAt: string;
}
export interface PullRequest {
  id: string;
  repository: string;
  number: number;
  title: string;
  description: string;
  author: string;
  revision: string;
  evidence: Evidence;
  route: Route | 'incoming';
  decision: Decision | null;
  assessment: Assessment | null;
  createdAt: string;
}
export interface PullRequestDetail extends PullRequest {
  assessments: Assessment[];
  decisions: Decision[];
  auditEvents: AuditEvent[];
  suggestedReviewers: Reviewer[];
}
export interface SimulationItem {
  id: string;
  title: string;
  repository: string;
  evidence: Evidence;
  scores: DimensionScore[] | null;
  currentRoute: Route;
  currentRequirements: ReviewerRequirements;
}
export interface SimulationChange {
  id: string;
  title: string;
  repository: string;
  from: Route;
  to: Route;
  direction: 'more' | 'less';
  reasons: string[];
}
export interface SimulationResult {
  evaluated: number;
  changes: SimulationChange[];
  reviewerDemandBefore: number;
  reviewerDemandAfter: number;
  routes: Record<Route, number>;
}
export const intakeSchema = z.object({
  repository: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,99}$/),
  number: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(12000),
  author: z.string().trim().min(1).max(100),
  revision: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  evidence: evidenceSchema,
});
export type Intake = z.infer<typeof intakeSchema>;
export const overrideSchema = z.object({
  route: routeSchema,
  reason: z.string().trim().min(1).max(2000),
  actor: z.string().trim().min(1).max(100).default('demo-operator'),
});
export const publishPolicySchema = z.object({
  policy: policySchema,
  actor: z.string().trim().min(1).max(100).default('demo-operator'),
  baseVersion: z.number().int().positive(),
});
