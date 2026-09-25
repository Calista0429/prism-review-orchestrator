import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  routePullRequest,
  requirementsFor,
  simulatePolicy,
} from '@prism/risk-engine';
import {
  scoresSchema,
  type Intake,
  type Policy,
  type Route,
} from '@prism/shared';
import type { AssessmentProvider } from './providers';
import type { Database, DatabaseConnection } from './db/client';
import * as t from './db/schema';
import {
  ApiError,
  currentPolicy,
  getDetail,
  listPullRequests,
} from './queries';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const hashState = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export async function idempotent<T>(
  connection: DatabaseConnection,
  key: string,
  request: unknown,
  action: (tx: Database) => Promise<T>,
): Promise<T> {
  const requestHash = hashState(request);
  return connection.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`idempotency:${key}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(t.idempotencyKeys)
      .where(eq(t.idempotencyKeys.key, key));
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was already used for a different request.',
        );
      return existing.response as T;
    }
    const response = await action(tx);
    await tx.insert(t.idempotencyKeys).values({ key, requestHash, response });
    return response;
  });
}
export async function assessPullRequest(
  db: Database,
  id: string,
  provider: AssessmentProvider,
) {
  await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, id))
    .for('update');
  const pr = await getDetail(db, id);
  const policy = await currentPolicy(db);
  const stateHash = hashState({
    title: pr.title,
    description: pr.description,
    revision: pr.revision,
    evidence: pr.evidence,
  });
  const [existing] = await db
    .select()
    .from(t.riskAssessments)
    .where(
      and(
        eq(t.riskAssessments.pullRequestId, id),
        eq(t.riskAssessments.policyVersionId, policy.id),
        eq(t.riskAssessments.stateHash, stateHash),
        eq(t.riskAssessments.provider, provider.name),
        eq(t.riskAssessments.requestedModel, provider.model),
        eq(t.riskAssessments.status, 'completed'),
      ),
    );
  // A repeated assessment never undoes a later manual override.
  if (existing) return pr;
  let scores = null;
  let model = provider.model;
  let errorCode: string | null = null;
  try {
    const result = await provider.assess(pr);
    scores = scoresSchema.parse(result.scores);
    model = result.model;
  } catch (error) {
    errorCode =
      error instanceof Error && error.message === 'DEMO_FIXTURE_NOT_FOUND'
        ? 'DEMO_FIXTURE_NOT_FOUND'
        : 'ASSESSMENT_PROVIDER_FAILED';
  }
  const result = routePullRequest(pr.evidence, scores, policy.policy);
  const assessmentId = randomUUID();
  const decisionId = randomUUID();
  await db.insert(t.riskAssessments).values({
    id: assessmentId,
    pullRequestId: id,
    policyVersionId: policy.id,
    provider: provider.name,
    model,
    requestedModel: provider.model,
    status: scores ? 'completed' : 'failed',
    stateHash,
    aggregateRisk: result.aggregateRisk,
    errorCode,
  });
  if (scores)
    await db
      .insert(t.dimensionScores)
      .values(scores.map((score) => ({ ...score, assessmentId })));
  await db.insert(t.routingDecisions).values({
    id: decisionId,
    pullRequestId: id,
    assessmentId,
    policyVersionId: policy.id,
    route: result.route,
    result,
    kind: 'assessment',
    actor: 'system',
  });
  await db.insert(t.auditEvents).values([
    {
      id: randomUUID(),
      type: scores ? 'assessment_completed' : 'assessment_failed',
      actor: 'system',
      pullRequestId: id,
      repository: pr.repository,
      route: result.route,
      details: { assessmentId, provider: provider.name, model, errorCode },
    },
    {
      id: randomUUID(),
      type: 'routing',
      actor: 'system',
      pullRequestId: id,
      repository: pr.repository,
      route: result.route,
      details: {
        decisionId,
        policyVersion: policy.version,
        reasons: result.reasons,
      },
    },
  ]);
  return getDetail(db, id);
}
export async function overridePullRequest(
  db: Database,
  id: string,
  body: { route: Route; reason: string; actor: string },
) {
  await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, id))
    .for('update');
  const pr = await getDetail(db, id);
  if (!pr.decision || !pr.assessment)
    throw new ApiError(
      409,
      'ASSESSMENT_REQUIRED',
      'Run triage before recording a manual override.',
    );
  const requirement = requirementsFor(body.route);
  // Human routing is explicit, but it does not erase guardrail reviewer obligations.
  const requirements = {
    count: Math.max(requirement.count, pr.decision.requirements.count),
    skills: [
      ...new Set([...requirement.skills, ...pr.decision.requirements.skills]),
    ],
    slaHours: Math.min(requirement.slaHours, pr.decision.requirements.slaHours),
  };
  const result = {
    route: body.route,
    aggregateRisk: pr.decision.aggregateRisk,
    confidence: pr.decision.confidence,
    reasons: [
      `Manual override by ${body.actor}: ${body.reason}`,
      ...pr.decision.reasons,
    ],
    requirements,
    downstreamSteps: [
      'Human approval of the override',
      ...pr.decision.downstreamSteps,
    ],
    autoMergeEligible: false,
  };
  const decisionId = randomUUID();
  await db.insert(t.routingDecisions).values({
    id: decisionId,
    pullRequestId: id,
    assessmentId: pr.assessment.id,
    policyVersionId: pr.decision.policyVersionId,
    route: body.route,
    result,
    kind: 'override',
    actor: body.actor,
    overrideReason: body.reason,
  });
  await db.insert(t.auditEvents).values({
    id: randomUUID(),
    type: 'override',
    actor: body.actor,
    pullRequestId: id,
    repository: pr.repository,
    route: body.route,
    details: {
      decisionId,
      previousDecisionId: pr.decision.id,
      from: pr.route,
      to: body.route,
      reason: body.reason,
    },
  });
  return getDetail(db, id);
}
export async function simulate(db: Database, policy: Policy) {
  const prs = await listPullRequests(db);
  return simulatePolicy(
    prs.flatMap((pr) =>
      pr.assessment && pr.decision
        ? [
            {
              id: pr.id,
              title: pr.title,
              repository: pr.repository,
              evidence: pr.evidence,
              scores:
                pr.assessment.status === 'completed'
                  ? pr.assessment.scores
                  : null,
              currentRoute: pr.decision.route,
              currentRequirements: pr.decision.requirements,
            },
          ]
        : [],
    ),
    policy,
  );
}
export async function publishPolicy(
  db: Database,
  body: { policy: Policy; actor: string; baseVersion: number },
) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(8723463)`);
  const current = await currentPolicy(db);
  if (current.version !== body.baseVersion)
    throw new ApiError(
      409,
      'POLICY_VERSION_CONFLICT',
      'The published policy changed. Reload and simulate your draft again.',
    );
  const [published] = await db
    .insert(t.policyVersions)
    .values({
      id: randomUUID(),
      version: current.version + 1,
      policy: body.policy,
      author: body.actor,
    })
    .returning();
  await db.insert(t.auditEvents).values({
    id: randomUUID(),
    type: 'policy_published',
    actor: body.actor,
    details: {
      policyVersionId: published.id,
      version: published.version,
      previousVersion: current.version,
    },
  });
  return published;
}
export async function intake(db: Database, body: Intake) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`intake:${body.repository}:${body.number}`}))`,
  );
  const [existingRepository] = await db
    .select()
    .from(t.repositories)
    .where(eq(t.repositories.name, body.repository));
  const criticalityRank = { normal: 0, high: 1, safety: 2 } as const;
  const requestedCriticality = body.evidence.repositoryCriticality;
  const repo = existingRepository
    ? criticalityRank[requestedCriticality] >
      criticalityRank[
        existingRepository.criticality as keyof typeof criticalityRank
      ]
      ? (
          await db
            .update(t.repositories)
            .set({ criticality: requestedCriticality })
            .where(eq(t.repositories.id, existingRepository.id))
            .returning()
        )[0]
      : existingRepository
    : (
        await db
          .insert(t.repositories)
          .values({
            id: randomUUID(),
            name: body.repository,
            criticality: requestedCriticality,
          })
          .returning()
      )[0];
  const [existing] = await db
    .select()
    .from(t.pullRequests)
    .where(
      and(
        eq(t.pullRequests.repositoryId, repo.id),
        eq(t.pullRequests.number, body.number),
      ),
    );
  if (existing)
    throw new ApiError(
      409,
      'PR_ALREADY_EXISTS',
      'This repository and pull request number already exists.',
    );
  const paths = [
    ...new Set(
      body.evidence.paths.map((p) =>
        p.replaceAll('\\', '/').replace(/^\.\//, ''),
      ),
    ),
  ];
  const sensitivePaths = [
    ...new Set([
      ...body.evidence.sensitivePaths,
      ...paths.filter((p) => /(^|\/)(state-machine|safety)(\.|\/|$)/i.test(p)),
    ]),
  ];
  const evidence = {
    ...body.evidence,
    paths,
    sensitivePaths,
    repositoryCriticality:
      repo.criticality as Intake['evidence']['repositoryCriticality'],
    hasMigration:
      body.evidence.hasMigration ||
      paths.some((p) => /(^|\/)migrations?\//i.test(p)),
  };
  const id = randomUUID();
  const { repository: _repository, ...pr } = body;
  await db
    .insert(t.pullRequests)
    .values({ ...pr, evidence, id, repositoryId: repo.id });
  await db.insert(t.auditEvents).values({
    id: randomUUID(),
    type: 'intake',
    actor: body.author,
    pullRequestId: id,
    repository: body.repository,
    details: { revision: body.revision },
  });
  return getDetail(db, id);
}
