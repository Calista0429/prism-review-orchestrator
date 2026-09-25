import { describe, expect, it } from 'vitest';
import { dimensions, type PullRequest } from '@prism/shared';
import { createProvider, scoreCriteria } from './providers';
const pr = {
  id: 'pr-dealer',
  title: 'Adjust spacing',
  description: 'Styles only',
  evidence: { paths: ['src/style.css'] },
} as PullRequest;
const answers = () =>
  Object.fromEntries(
    dimensions.map((d) => [
      d,
      {
        type: 'score',
        score: 1,
        confidence: 0.9,
        legend: Object.fromEntries(scoreCriteria[d].map((v, i) => [i, v])),
        probabilities: { '0': 0.05, '1': 0.9, '2': 0.03, '3': 0.01, '4': 0.01 },
      },
    ]),
  );
const fakeFetch = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
describe('OpenRouter Decisions adapter', () => {
  it('fails startup without credentials only in live mode', () => {
    expect(() => createProvider({ mode: 'openrouter' })).toThrow(/key/i);
    expect(createProvider({ mode: 'demo' }).name).toBe('demo');
  });
  it('sends five independent Score questions to Decisions and normalizes 0–4 to 0–10', async () => {
    let request: Record<string, unknown> = {};
    let url = '';
    const fetcher: typeof fetch = async (input, init) => {
      url = String(input);
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: 'typesafe/jev-1.13-20260917',
          answers: answers(),
        }),
      );
    };
    const result = await createProvider({
      mode: 'openrouter',
      apiKey: 'test-key',
      fetcher,
    }).assess(pr);
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(request.model).toBe('typesafe/jev-1.13');
    expect(Object.keys(request.questions as object)).toHaveLength(5);
    expect(result.scores).toHaveLength(5);
    expect(result.scores[0].score).toBe(2.5);
    expect(result.model).toBe('typesafe/jev-1.13-20260917');
  });
  it('accepts Jev fractional scores and normalizes rounded probabilities', async () => {
    const body = answers();
    for (const dimension of dimensions) {
      body[dimension].score = 1.99;
      body[dimension].probabilities = {
        '0': 0,
        '1': 0.01,
        '2': 0.99,
        '3': 0,
        '4': 0,
      };
    }
    const result = await createProvider({
      mode: 'openrouter',
      apiKey: 'test-key',
      fetcher: fakeFetch({ model: 'typesafe/jev-1.13', answers: body }),
    }).assess(pr);
    expect(result.scores[0].score).toBe(4.975);
    expect(
      result.scores[0].probabilities.reduce((sum, value) => sum + value, 0),
    ).toBeCloseTo(1);
    const upperRounded = answers();
    for (const dimension of dimensions)
      upperRounded[dimension].probabilities = {
        '0': 0.01,
        '1': 0.01,
        '2': 0.33,
        '3': 0.33,
        '4': 0.33,
      };
    await expect(
      createProvider({
        mode: 'openrouter',
        apiKey: 'test-key',
        fetcher: fakeFetch({
          model: 'typesafe/jev-1.13',
          answers: upperRounded,
        }),
      }).assess(pr),
    ).resolves.toBeTruthy();
  });
  it.each([
    'missing',
    'invalid-score',
    'invalid-confidence',
    'bad-sum',
    'bad-legend',
    'missing-probability',
  ])('rejects %s response', async (kind) => {
    const body = answers();
    if (kind === 'missing') delete body.scope;
    if (kind === 'invalid-score') body.scope.score = 8;
    if (kind === 'invalid-confidence') body.scope.confidence = 2;
    if (kind === 'bad-sum') body.scope.probabilities['0'] = 1;
    if (kind === 'bad-legend') body.scope.legend['0'] = 'Different rubric';
    if (kind === 'missing-probability')
      delete (body.scope.probabilities as Record<string, number>)['4'];
    await expect(
      createProvider({
        mode: 'openrouter',
        apiKey: 'test-key',
        fetcher: fakeFetch({ model: 'typesafe/jev-1.13', answers: body }),
      }).assess(pr),
    ).rejects.toThrow();
  });
  it('rejects a materially invalid probability total', async () => {
    const body = answers();
    body.scope.probabilities = {
      '0': 0.1,
      '1': 0.1,
      '2': 0.1,
      '3': 0.1,
      '4': 0.1,
    };
    await expect(
      createProvider({
        mode: 'openrouter',
        apiKey: 'test-key',
        fetcher: fakeFetch({ model: 'typesafe/jev-1.13', answers: body }),
      }).assess(pr),
    ).rejects.toThrow();
  });
  it('does not fall back to demo on HTTP failure', async () => {
    await expect(
      createProvider({
        mode: 'openrouter',
        apiKey: 'test-key',
        fetcher: fakeFetch({ secret: 'do-not-log' }, 503),
      }).assess(pr),
    ).rejects.toThrow('PROVIDER_UNAVAILABLE');
  });
  it('demo refuses unknown fixture PRs', async () => {
    await expect(
      createProvider({ mode: 'demo' }).assess({ ...pr, id: 'unknown' }),
    ).rejects.toThrow('DEMO_FIXTURE_NOT_FOUND');
  });
});
