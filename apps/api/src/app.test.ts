import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type DatabaseConnection } from './db/client';
import { migrate } from './db/migrate';
import { seed } from './db/seed';
import { buildApp } from './app';
import { createProvider, type AssessmentProvider } from './providers';
import type { FastifyInstance } from 'fastify';
import { defaultPolicy } from '@prism/shared';
let database: DatabaseConnection;
let app: FastifyInstance;
const post = (
  url: string,
  body: Record<string, unknown> = {},
  key: string = crypto.randomUUID(),
) =>
  app.inject({
    method: 'POST',
    url,
    payload: body,
    headers: { 'idempotency-key': key },
  });
beforeEach(async () => {
  database = await createDatabase('pglite:memory');
  await migrate(database);
  await seed(database);
  app = buildApp(database, createProvider({ mode: 'demo' }));
});
afterEach(async () => {
  await app?.close();
  await database?.close();
});

describe('assessment lifecycle', () => {
  it('starts all five fixtures in Incoming and routes each as designed', async () => {
    const list = (await app.inject('/api/pull-requests')).json();
    expect(list).toHaveLength(5);
    expect(list.every((p: { route: string }) => p.route === 'incoming')).toBe(
      true,
    );
    for (const [id, route] of [
      ['pr-dealer', 'fast'],
      ['pr-diagnostic', 'critical'],
      ['pr-telemetry', 'critical'],
      ['pr-configurator', 'triage'],
      ['pr-booking', 'standard'],
    ]) {
      const result = await post(`/api/pull-requests/${id}/assessments`);
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().decision.route).toBe(route);
      expect(result.json().assessment.scores).toHaveLength(5);
    }
  });
  it('deduplicates concurrent same-revision assessments even with different keys', async () => {
    const replies = await Promise.all([
      post('/api/pull-requests/pr-dealer/assessments'),
      post('/api/pull-requests/pr-dealer/assessments'),
    ]);
    expect(replies.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(replies[0].json().assessment.id).toBe(
      replies[1].json().assessment.id,
    );
    const detail = (await app.inject('/api/pull-requests/pr-dealer')).json();
    expect(detail.assessments).toHaveLength(1);
    expect(detail.decisions).toHaveLength(1);
  });
  it('replays keys and rejects reuse for another operation', async () => {
    const first = await post(
      '/api/pull-requests/pr-dealer/assessments',
      {},
      'same-key',
    );
    const repeated = await post(
      '/api/pull-requests/pr-dealer/assessments',
      {},
      'same-key',
    );
    expect(repeated.json()).toEqual(first.json());
    expect(
      (await post('/api/pull-requests/pr-booking/assessments', {}, 'same-key'))
        .statusCode,
    ).toBe(409);
  });
  it('stores provider failure as triage and allows a new-key retry', async () => {
    await app.close();
    const provider: AssessmentProvider = {
      name: 'openrouter',
      model: 'typesafe/jev-1.13',
      assess: async () => {
        throw new Error('secret-provider-body');
      },
    };
    app = buildApp(database, provider);
    const result = await post('/api/pull-requests/pr-dealer/assessments');
    expect(result.statusCode).toBe(200);
    expect(result.json().route).toBe('triage');
    expect(result.json().assessment.status).toBe('failed');
    expect(result.json().assessment.scores).toEqual([]);
    expect(result.body).not.toContain('secret-provider-body');
    await post('/api/pull-requests/pr-dealer/assessments');
    expect(
      (await app.inject('/api/pull-requests/pr-dealer')).json().assessments,
    ).toHaveLength(2);
  });
  it('rolls back assessment and decision when audit persistence fails', async () => {
    await database.raw(
      `CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$; CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_audit();`,
    );
    const result = await post('/api/pull-requests/pr-dealer/assessments');
    expect(result.statusCode).toBe(500);
    const detail = (await app.inject('/api/pull-requests/pr-dealer')).json();
    expect(detail.route).toBe('incoming');
    expect(detail.assessments).toHaveLength(0);
    expect(detail.decisions).toHaveLength(0);
  });
});

describe('governance', () => {
  it('requires an override reason, preserves history, and audits the new decision', async () => {
    await post('/api/pull-requests/pr-dealer/assessments');
    expect(
      (
        await post('/api/pull-requests/pr-dealer/overrides', {
          route: 'standard',
          reason: '  ',
        })
      ).statusCode,
    ).toBe(400);
    const result = await post('/api/pull-requests/pr-dealer/overrides', {
      route: 'standard',
      reason: 'Request a UI accessibility review',
      actor: 'lead',
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().route).toBe('standard');
    expect(result.json().decisions).toHaveLength(2);
    expect(result.json().decision.autoMergeEligible).toBe(false);
    const audit = (
      await app.inject(
        '/api/audit-events?actor=lead&type=override&route=standard&repository=dealer-portal',
      )
    ).json();
    expect(audit).toHaveLength(1);
    expect(audit[0].details.reason).toBe('Request a UI accessibility review');
    await post('/api/pull-requests/pr-dealer/assessments');
    expect(
      (await app.inject('/api/pull-requests/pr-dealer')).json().route,
    ).toBe('standard');
  });
  it('rejects an override before an assessment exists', async () => {
    expect(
      (
        await post('/api/pull-requests/pr-dealer/overrides', {
          route: 'standard',
          reason: 'Review',
        })
      ).statusCode,
    ).toBe(409);
  });
  it('simulates without publishing and publishes immutable versioned policy with optimistic concurrency', async () => {
    await post('/api/pull-requests/pr-dealer/assessments');
    const draft = { ...defaultPolicy, fastThreshold: 0.5 };
    const simulation = await post('/api/policies/simulate', { policy: draft });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json().changes).toHaveLength(1);
    expect((await app.inject('/api/policies/current')).json().version).toBe(1);
    const published = await post('/api/policies', {
      policy: draft,
      baseVersion: 1,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().version).toBe(2);
    expect(
      (await post('/api/policies', { policy: draft, baseVersion: 1 }))
        .statusCode,
    ).toBe(409);
    const detail = (await app.inject('/api/pull-requests/pr-dealer')).json();
    expect(detail.decision.policyVersion).toBe(1);
    expect(detail.route).toBe('fast');
    await expect(
      database.db.execute(sql`UPDATE policy_versions SET author = 'changed'`),
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`DELETE FROM audit_events`),
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`UPDATE routing_decisions SET actor = 'changed'`),
    ).rejects.toThrow();
  });
  it('seeding and migration are repeatable and never reset decisions', async () => {
    await post('/api/pull-requests/pr-dealer/assessments');
    await migrate(database);
    await seed(database);
    expect((await app.inject('/api/pull-requests')).json()).toHaveLength(5);
    expect(
      (await app.inject('/api/pull-requests/pr-dealer')).json().route,
    ).toBe('fast');
  });
  it('validates inputs, missing keys, unknown PRs, and invalid audit dates', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/pull-requests/pr-dealer/assessments',
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post('/api/pull-requests/missing/assessments')).statusCode,
    ).toBe(404);
    expect(
      (
        await post('/api/policies', {
          policy: { ...defaultPolicy, fastThreshold: 9 },
          baseVersion: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject('/api/audit-events?from=invalid')).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject(
          '/api/audit-events?from=2026-09-26T00:00:00Z&to=2026-09-25T00:00:00Z',
        )
      ).statusCode,
    ).toBe(400);
  });
  it('supports local normalized intake and rejects duplicate PR identity', async () => {
    const sample = (await app.inject('/api/pull-requests/pr-dealer')).json();
    const body = {
      repository: 'new-repo',
      number: 42,
      title: 'New change',
      description: 'Test intake',
      author: 'dev',
      revision: 'abcdef',
      evidence: sample.evidence,
    };
    const created = await post('/api/pull-requests', body);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().route).toBe('incoming');
    expect((await post('/api/pull-requests', body)).statusCode).toBe(409);
  });
  it('preserves the strongest repository criticality across intake records', async () => {
    const sample = (await app.inject('/api/pull-requests/pr-dealer')).json();
    const first = await post('/api/pull-requests', {
      repository: 'dealer-portal',
      number: 999,
      title: 'Safety intake',
      description: 'A stricter repository declaration.',
      author: 'dev',
      revision: 'safety-1',
      evidence: { ...sample.evidence, repositoryCriticality: 'safety' },
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().evidence.repositoryCriticality).toBe('safety');
    const second = await post('/api/pull-requests', {
      repository: 'dealer-portal',
      number: 1000,
      title: 'Later intake',
      description: 'Cannot downgrade the repository.',
      author: 'dev',
      revision: 'safety-2',
      evidence: { ...sample.evidence, repositoryCriticality: 'normal' },
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().evidence.repositoryCriticality).toBe('safety');
  });
});
