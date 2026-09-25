import { describe, expect, it } from 'vitest';
import {
  defaultPolicy,
  dimensions,
  type DimensionScore,
  type Evidence,
} from '@prism/shared';
import { routePullRequest, suggestReviewers, simulatePolicy } from './index';

const evidence: Evidence = {
  filesChanged: 2,
  linesAdded: 14,
  linesDeleted: 4,
  ci: 'passed',
  hasMigration: false,
  sensitivePaths: [],
  ownerCoverage: true,
  repositoryCriticality: 'normal',
  paths: ['src/style.css'],
  rollback: 'Revert commit',
};
const scores = (value = 1, confidence = 0.95): DimensionScore[] =>
  dimensions.map((dimension) => ({
    dimension,
    score: value,
    confidence,
    criteria: ['None', 'Low', 'Moderate', 'High', 'Severe'],
    probabilities: [0.05, 0.8, 0.1, 0.04, 0.01],
  }));

describe('routing', () => {
  it.each([
    [1, 'fast'],
    [3, 'standard'],
    [6, 'critical'],
    [10, 'critical'],
  ])('routes risk %s to %s with inclusive thresholds', (value, route) => {
    expect(routePullRequest(evidence, scores(value), defaultPolicy).route).toBe(
      route,
    );
  });
  it('weights dimensions in application code', () => {
    const values = scores(0);
    values[0].score = 10;
    expect(
      routePullRequest(evidence, values, defaultPolicy).aggregateRisk,
    ).toBe(2);
  });
  it.each(['failed', 'pending', 'unknown'] as const)(
    'prevents fast lane when CI is %s',
    (ci) => {
      const result = routePullRequest(
        { ...evidence, ci },
        scores(),
        defaultPolicy,
      );
      expect(result.route).toBe('standard');
      expect(result.autoMergeEligible).toBe(false);
    },
  );
  it('requires at least standard for migrations', () => {
    expect(
      routePullRequest(
        { ...evidence, hasMigration: true },
        scores(),
        defaultPolicy,
      ).route,
    ).toBe('standard');
  });
  it('escalates sensitive paths irrespective of low risk', () => {
    const result = routePullRequest(
      { ...evidence, sensitivePaths: ['src/state-machine.ts'] },
      scores(),
      defaultPolicy,
    );
    expect(result.route).toBe('critical');
    expect(result.requirements.skills).toContain('domain');
  });
  it('uses weakest dimension confidence and preserves critical requirements in triage', () => {
    const values = scores();
    values[2].confidence = 0.4;
    const result = routePullRequest(
      { ...evidence, sensitivePaths: ['safety.ts'] },
      values,
      defaultPolicy,
    );
    expect(result.route).toBe('triage');
    expect(result.confidence).toBe(0.4);
    expect(result.requirements.skills).toContain('domain');
    expect(result.autoMergeEligible).toBe(false);
  });
  it('routes missing ownership to triage', () => {
    expect(
      routePullRequest(
        { ...evidence, ownerCoverage: false },
        scores(),
        defaultPolicy,
      ).route,
    ).toBe('triage');
  });
  it('routes failed assessments to triage without fabricating scores', () => {
    const result = routePullRequest(evidence, null, defaultPolicy);
    expect(result.route).toBe('triage');
    expect(result.aggregateRisk).toBeNull();
    expect(result.confidence).toBeNull();
  });
  it('rejects incomplete and duplicate score dimensions', () => {
    expect(() =>
      routePullRequest(evidence, scores().slice(1), defaultPolicy),
    ).toThrow();
    const values = scores();
    values[1].dimension = values[0].dimension;
    expect(() => routePullRequest(evidence, values, defaultPolicy)).toThrow();
  });
  it('rejects nonfinite scores and invalid policies', () => {
    expect(() =>
      routePullRequest(evidence, scores(NaN), defaultPolicy),
    ).toThrow();
    expect(() =>
      routePullRequest(evidence, scores(), {
        ...defaultPolicy,
        fastThreshold: 8,
        criticalThreshold: 6,
      }),
    ).toThrow();
  });
});

it('suggests available skilled reviewers, excludes author, and ranks by utilization', () => {
  const reviewers = [
    {
      id: 'a',
      name: 'Author',
      username: 'author',
      skills: ['domain'],
      capacity: 4,
      activeAssignments: 0,
      available: true,
    },
    {
      id: 'b',
      name: 'Busy',
      username: 'busy',
      skills: ['domain'],
      capacity: 4,
      activeAssignments: 3,
      available: true,
    },
    {
      id: 'c',
      name: 'Free',
      username: 'free',
      skills: ['domain'],
      capacity: 4,
      activeAssignments: 1,
      available: true,
    },
    {
      id: 'd',
      name: 'Away',
      username: 'away',
      skills: ['domain'],
      capacity: 4,
      activeAssignments: 0,
      available: false,
    },
    {
      id: 'e',
      name: 'Full',
      username: 'full',
      skills: ['domain'],
      capacity: 4,
      activeAssignments: 4,
      available: true,
    },
  ];
  expect(
    suggestReviewers(
      reviewers,
      { count: 2, skills: ['domain'], slaHours: 4 },
      'author',
    ).map((r) => r.id),
  ).toEqual(['c', 'b']);
});

it('simulates stored scores without mutating the published policy or inputs', () => {
  const items = [
    {
      id: 'pr-1',
      title: 'Styles',
      repository: 'dealer-portal',
      evidence,
      scores: scores(2),
      currentRoute: 'fast' as const,
      currentRequirements: { count: 0, skills: [], slaHours: 4 },
    },
  ];
  const before = JSON.stringify(items);
  const result = simulatePolicy(items, { ...defaultPolicy, fastThreshold: 1 });
  expect(result.changes).toEqual([
    expect.objectContaining({
      id: 'pr-1',
      from: 'fast',
      to: 'standard',
      direction: 'more',
    }),
  ]);
  expect(result.reviewerDemandAfter).toBe(1);
  expect(JSON.stringify(items)).toBe(before);
  expect(defaultPolicy.fastThreshold).toBe(3);
});

it('uses persisted reviewer obligations for simulation demand', () => {
  const items = [
    {
      id: 'pr-guarded',
      title: 'Sensitive change',
      repository: 'diagnostic-gateway',
      evidence: { ...evidence, sensitivePaths: ['src/state-machine.ts'] },
      scores: scores(1),
      currentRoute: 'triage' as const,
      currentRequirements: {
        count: 2,
        skills: ['domain', 'triage'],
        slaHours: 4,
      },
    },
  ];
  const result = simulatePolicy(items, defaultPolicy);
  expect(result.reviewerDemandBefore).toBe(2);
  expect(result.reviewerDemandAfter).toBe(2);
});
