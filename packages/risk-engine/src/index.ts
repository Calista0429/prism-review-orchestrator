import {
  evidenceSchema,
  policySchema,
  scoresSchema,
  type DimensionScore,
  type Evidence,
  type Policy,
  type Reviewer,
  type ReviewerRequirements,
  type Route,
  type RoutingResult,
  type SimulationItem,
  type SimulationResult,
} from '@prism/shared';

export function requirementsFor(route: Route): ReviewerRequirements {
  switch (route) {
    case 'fast':
      return { count: 0, skills: [], slaHours: 4 };
    case 'standard':
      return { count: 1, skills: ['general'], slaHours: 24 };
    case 'critical':
      return { count: 2, skills: ['domain'], slaHours: 4 };
    case 'triage':
      return { count: 1, skills: ['triage'], slaHours: 8 };
  }
}

export function routePullRequest(
  evidence: Evidence,
  scores: DimensionScore[] | null,
  policy: Policy,
): RoutingResult {
  evidenceSchema.parse(evidence);
  policySchema.parse(policy);
  if (scores !== null) scoresSchema.parse(scores);
  const rawRisk =
    scores === null
      ? null
      : scores.reduce(
          (total, s) => total + s.score * policy.weights[s.dimension],
          0,
        );
  const aggregateRisk =
    rawRisk === null ? null : Math.round(rawRisk * 100) / 100;
  const confidence =
    scores === null ? null : Math.min(...scores.map((s) => s.confidence));
  let route: Route =
    rawRisk === null
      ? 'triage'
      : rawRisk >= policy.criticalThreshold
        ? 'critical'
        : rawRisk >= policy.fastThreshold
          ? 'standard'
          : 'fast';
  const reasons: string[] = [
    rawRisk === null
      ? 'Assessment failed. A human must assess this change.'
      : `Weighted risk ${aggregateRisk}/10; Fast lane below ${policy.fastThreshold}, Critical from ${policy.criticalThreshold}.`,
  ];
  if (evidence.ci !== 'passed') {
    if (route === 'fast') route = 'standard';
    reasons.push(`Required CI is ${evidence.ci}; Fast lane is unavailable.`);
  }
  if (evidence.hasMigration) {
    if (route === 'fast') route = 'standard';
    reasons.push('Database migration requires at least Standard review.');
  }
  if (evidence.filesChanged > 30) {
    if (route === 'fast') route = 'standard';
    reasons.push(
      'More than 30 changed files requires at least Standard review.',
    );
  }
  if (
    evidence.sensitivePaths.length ||
    evidence.repositoryCriticality === 'safety'
  ) {
    route = 'critical';
    reasons.push(
      evidence.sensitivePaths.length
        ? `Sensitive paths require Critical review: ${evidence.sensitivePaths.join(', ')}.`
        : 'Safety-critical repository requires Critical review.',
    );
  }
  const guardrailRequirements = requirementsFor(route);
  if (confidence === null || confidence < policy.confidenceThreshold) {
    route = 'triage';
    reasons.push(
      confidence === null
        ? 'No usable confidence is available.'
        : `Weakest dimension confidence ${(confidence * 100).toFixed(0)}% is below ${(policy.confidenceThreshold * 100).toFixed(0)}%.`,
    );
  }
  if (!evidence.ownerCoverage) {
    route = 'triage';
    reasons.push('Required CODEOWNER coverage is missing.');
  }
  const requirements = requirementsFor(route);
  if (route === 'triage' && guardrailRequirements.count >= 2) {
    requirements.count = guardrailRequirements.count;
    requirements.skills = [
      ...new Set([...guardrailRequirements.skills, ...requirements.skills]),
    ];
  }
  if (evidence.hasMigration && !requirements.skills.includes('database'))
    requirements.skills.push('database');
  const downstreamSteps =
    route === 'triage'
      ? [
          'Resolve uncertainty with a triage owner',
          'Confirm required ownership and risk evidence',
          'Rerun assessment or record a reasoned override',
        ]
      : route === 'critical'
        ? [
            'Domain owner review',
            'Independent human review',
            'Passing required CI checks',
          ]
        : route === 'standard'
          ? [
              'PR-Agent review (suggested external step)',
              'Human reviewer approval',
              'Passing required CI checks',
            ]
          : [
              'Passing required CI checks',
              'Check branch protection before merge',
            ];
  return {
    route,
    aggregateRisk,
    confidence,
    reasons,
    requirements,
    downstreamSteps,
    autoMergeEligible: route === 'fast' && evidence.ci === 'passed',
  };
}

export function suggestReviewers(
  reviewers: Reviewer[],
  requirements: ReviewerRequirements,
  author: string,
): Reviewer[] {
  return reviewers
    .filter(
      (r) =>
        r.username !== author &&
        r.available &&
        r.activeAssignments < r.capacity &&
        requirements.skills.every((skill) => r.skills.includes(skill)),
    )
    .sort(
      (a, b) =>
        a.activeAssignments / a.capacity - b.activeAssignments / b.capacity ||
        a.name.localeCompare(b.name),
    )
    .slice(0, requirements.count);
}

export function simulatePolicy(
  items: SimulationItem[],
  policy: Policy,
): SimulationResult {
  policySchema.parse(policy);
  const result: SimulationResult = {
    evaluated: items.length,
    changes: [],
    reviewerDemandBefore: 0,
    reviewerDemandAfter: 0,
    routes: { fast: 0, standard: 0, critical: 0, triage: 0 },
  };
  const rank: Record<Route, number> = {
    fast: 0,
    standard: 1,
    critical: 2,
    triage: 3,
  };
  for (const item of items) {
    const next = routePullRequest(item.evidence, item.scores, policy);
    result.routes[next.route]++;
    result.reviewerDemandBefore += item.currentRequirements.count;
    result.reviewerDemandAfter += next.requirements.count;
    if (next.route !== item.currentRoute)
      result.changes.push({
        id: item.id,
        title: item.title,
        repository: item.repository,
        from: item.currentRoute,
        to: next.route,
        direction: rank[next.route] > rank[item.currentRoute] ? 'more' : 'less',
        reasons: next.reasons,
      });
  }
  return result;
}
