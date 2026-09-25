import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './client';
import { migrate } from './migrate';

it('creates missing PGlite parent directories and reopens persisted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prism-pglite-'));
  const dbPath = join(root, 'nested', 'database');
  const first = await createDatabase(`pglite:${dbPath}`);
  await migrate(first);
  await first.raw('INSERT INTO schema_migrations(version) VALUES (99)');
  await first.close();
  const second = await createDatabase(`pglite:${dbPath}`);
  const rows = await second.raw(
    'SELECT version FROM schema_migrations WHERE version = 99',
  );
  expect(
    (rows as Array<{ rows: Array<{ version: number }> }>)[0]?.rows,
  ).toEqual([{ version: 99 }]);
  await second.close();
  await rm(root, { recursive: true, force: true });
});
