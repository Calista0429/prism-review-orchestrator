import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type {
  Assessment,
  AuditEvent,
  Decision,
  PolicyVersion,
  PullRequest,
  PullRequestDetail,
  Reviewer,
  Route,
} from '@prism/shared';
import type { Database } from './db/client';
import * as t from './db/schema';
import { suggestReviewers } from '@prism/risk-engine';
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function currentPolicy(db: Database): Promise<PolicyVersion> {
  const [policy] = await db
    .select()
    .from(t.policyVersions)
    .orderBy(desc(t.policyVersions.version))
    .limit(1);
  if (!policy)
    throw new ApiError(
      503,
      'NOT_INITIALIZED',
      'Database has no policy. Run the seed command.',
    );
  return policy;
}
export async function listReviewers(db: Database): Promise<Reviewer[]> {
  const [people, skills, assignments] = await Promise.all([
    db.select().from(t.reviewers),
    db.select().from(t.reviewerSkills),
    db
      .select()
      .from(t.reviewAssignments)
      .where(eq(t.reviewAssignments.status, 'active')),
  ]);
  return people.map((person) => ({
    ...person,
    skills: skills
      .filter((s) => s.reviewerId === person.id)
      .map((s) => s.skill),
    activeAssignments: assignments.filter((a) => a.reviewerId === person.id)
      .length,
  }));
}
export interface AuditFilter {
  repository?: string;
  pullRequestId?: string;
  route?: Route;
  actor?: string;
  type?: string;
  from?: string;
  to?: string;
}
export async function listAudit(
  db: Database,
  filters: AuditFilter = {},
): Promise<AuditEvent[]> {
  const clauses: SQL[] = [];
  for (const key of [
    'repository',
    'pullRequestId',
    'route',
    'actor',
    'type',
  ] as const)
    if (filters[key]) clauses.push(eq(t.auditEvents[key], filters[key]!));
  if (filters.from) clauses.push(gte(t.auditEvents.createdAt, filters.from));
  if (filters.to) clauses.push(lte(t.auditEvents.createdAt, filters.to));
  return db
    .select({
      id: t.auditEvents.id,
      type: t.auditEvents.type,
      actor: t.auditEvents.actor,
      pullRequestId: t.auditEvents.pullRequestId,
      repository: t.auditEvents.repository,
      route: t.auditEvents.route,
      details: t.auditEvents.details,
      createdAt: t.auditEvents.createdAt,
    })
    .from(t.auditEvents)
    .where(and(...clauses))
    .orderBy(desc(t.auditEvents.sequence));
}
export async function getDetail(
  db: Database,
  id: string,
): Promise<PullRequestDetail> {
  const [row] = await db
    .select({ pr: t.pullRequests, repository: t.repositories.name })
    .from(t.pullRequests)
    .innerJoin(
      t.repositories,
      eq(t.pullRequests.repositoryId, t.repositories.id),
    )
    .where(eq(t.pullRequests.id, id));
  if (!row)
    throw new ApiError(
      404,
      'PR_NOT_FOUND',
      'Pull request was not found. Return to the command center.',
    );
  const decisionRows = await db
    .select({
      decision: t.routingDecisions,
      policyVersion: t.policyVersions.version,
    })
    .from(t.routingDecisions)
    .innerJoin(
      t.policyVersions,
      eq(t.routingDecisions.policyVersionId, t.policyVersions.id),
    )
    .where(eq(t.routingDecisions.pullRequestId, id))
    .orderBy(desc(t.routingDecisions.sequence));
  const decisions: Decision[] = decisionRows.map(
    ({ decision: d, policyVersion }) => ({
      ...d.result,
      id: d.id,
      assessmentId: d.assessmentId,
      policyVersionId: d.policyVersionId,
      policyVersion,
      kind: d.kind,
      actor: d.actor,
      createdAt: d.createdAt,
      overrideReason: d.overrideReason,
    }),
  );
  // Anchor the compound read on immutable decisions first. Every persisted assessment has a decision;
  // this prevents a newly committed decision from being returned without its referenced assessment.
  const assessmentIds = [
    ...new Set(decisionRows.map(({ decision }) => decision.assessmentId)),
  ];
  const assessmentRows = assessmentIds.length
    ? await db
        .select()
        .from(t.riskAssessments)
        .where(
          and(
            eq(t.riskAssessments.pullRequestId, id),
            inArray(t.riskAssessments.id, assessmentIds),
          ),
        )
        .orderBy(desc(t.riskAssessments.sequence))
    : [];
  const scores = assessmentRows.length
    ? await db
        .select()
        .from(t.dimensionScores)
        .where(
          inArray(
            t.dimensionScores.assessmentId,
            assessmentRows.map((a) => a.id),
          ),
        )
    : [];
  const assessments: Assessment[] = assessmentRows.map((a) => ({
    id: a.id,
    provider: a.provider,
    model: a.model,
    status: a.status,
    stateHash: a.stateHash,
    errorCode: a.errorCode,
    createdAt: a.createdAt,
    scores: scores
      .filter((s) => s.assessmentId === a.id)
      .map(({ dimension, score, confidence, criteria, probabilities }) => ({
        dimension,
        score,
        confidence,
        criteria,
        probabilities,
      })),
  }));
  const decision = decisions[0] ?? null;
  const assessment = decision
    ? (assessments.find((a) => a.id === decision.assessmentId) ?? null)
    : null;
  const { repositoryId: _repositoryId, ...pr } = row.pr;
  return {
    ...pr,
    repository: row.repository,
    route: decision?.route ?? 'incoming',
    decision,
    assessment,
    assessments,
    decisions,
    auditEvents: await listAudit(db, { pullRequestId: id }),
    suggestedReviewers: decision
      ? suggestReviewers(
          await listReviewers(db),
          decision.requirements,
          pr.author,
        )
      : [],
  };
}
export async function listPullRequests(db: Database): Promise<PullRequest[]> {
  const ids = await db
    .select({ id: t.pullRequests.id })
    .from(t.pullRequests)
    .orderBy(t.pullRequests.createdAt, t.pullRequests.id);
  return Promise.all(
    ids.map(async ({ id }) => {
      const {
        assessments: _assessments,
        decisions: _decisions,
        auditEvents: _audit,
        suggestedReviewers: _reviewers,
        ...pr
      } = await getDetail(db, id);
      return pr;
    }),
  );
}
