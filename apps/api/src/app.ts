import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import {
  intakeSchema,
  overrideSchema,
  policySchema,
  publishPolicySchema,
  routeSchema,
} from '@prism/shared';
import type { DatabaseConnection } from './db/client';
import type { AssessmentProvider } from './providers';
import {
  ApiError,
  currentPolicy,
  getDetail,
  listAudit,
  listPullRequests,
  listReviewers,
} from './queries';
import {
  assessPullRequest,
  idempotent,
  intake,
  overridePullRequest,
  publishPolicy,
  simulate,
} from './service';
const idSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
});
const keySchema = z.string().trim().min(1).max(200);
const auditSchema = z
  .object({
    repository: z.string().max(100).optional(),
    pullRequestId: z.string().max(100).optional(),
    route: routeSchema.optional(),
    actor: z.string().max(100).optional(),
    type: z.string().max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (f) => !f.from || !f.to || new Date(f.from) <= new Date(f.to),
    'Start date must not be after end date',
  );
export function buildApp(
  database: DatabaseConnection,
  provider: AssessmentProvider,
) {
  const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues
            .map((i) => `${i.path.join('.') || 'Request'}: ${i.message}`)
            .join('; '),
        },
      });
    if (error instanceof ApiError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    const errorStatus =
      error !== null && typeof error === 'object' && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const status =
      typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500
        ? errorStatus
        : 500;
    return reply.code(status).send({
      error: {
        code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message:
          status < 500
            ? 'Request could not be parsed. Check the request format.'
            : 'The operation could not be saved. Retry the request.',
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'API endpoint not found.' },
    }),
  );
  app.get('/health', async () => ({ status: 'ok', provider: provider.name }));
  app.get('/api/pull-requests', () => listPullRequests(database.db));
  app.get('/api/pull-requests/:id', (request) =>
    getDetail(database.db, idSchema.parse(request.params).id),
  );
  app.get('/api/policies/current', () => currentPolicy(database.db));
  app.get('/api/reviewers', () => listReviewers(database.db));
  app.get('/api/audit-events', (request) =>
    listAudit(database.db, auditSchema.parse(request.query)),
  );
  app.post('/api/pull-requests/:id/assessments', (request) => {
    const { id } = idSchema.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const key = keySchema.parse(request.headers['idempotency-key']);
    return idempotent(database, key, { action: 'assess', id }, (tx) =>
      assessPullRequest(tx, id, provider),
    );
  });
  app.post('/api/pull-requests/:id/overrides', (request) => {
    const { id } = idSchema.parse(request.params);
    const body = overrideSchema.parse(request.body);
    const key = keySchema.parse(request.headers['idempotency-key']);
    return idempotent(database, key, { action: 'override', id, body }, (tx) =>
      overridePullRequest(tx, id, body),
    );
  });
  app.post('/api/policies/simulate', (request) => {
    const body = z.object({ policy: policySchema }).parse(request.body);
    const key = keySchema.parse(request.headers['idempotency-key']);
    return idempotent(database, key, { action: 'simulate', body }, (tx) =>
      simulate(tx, body.policy),
    );
  });
  app.post('/api/policies', (request) => {
    const body = publishPolicySchema.parse(request.body);
    const key = keySchema.parse(request.headers['idempotency-key']);
    return idempotent(database, key, { action: 'publish', body }, (tx) =>
      publishPolicy(tx, body),
    );
  });
  app.post('/api/pull-requests', async (request, reply) => {
    const body = intakeSchema.parse(request.body);
    const key = keySchema.parse(request.headers['idempotency-key']);
    const result = await idempotent(
      database,
      key,
      { action: 'intake', body },
      (tx) => intake(tx, body),
    );
    return reply.code(201).send(result);
  });
  return app;
}
