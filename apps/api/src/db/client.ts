import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DatabaseConnection {
  db: Database;
  raw(query: string): Promise<unknown>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function createDatabase(url: string): Promise<DatabaseConnection> {
  if (url.startsWith('pglite:')) {
    const path = url.slice('pglite:'.length);
    if (path !== 'memory') await mkdir(dirname(path), { recursive: true });
    const client = new PGlite(path === 'memory' ? undefined : path);
    await client.waitReady;
    const db = pgliteDrizzle(client, { schema });
    return {
      db,
      raw: (query) => client.exec(query),
      transaction: (fn) => db.transaction(fn),
      close: () => client.close(),
    };
  }
  if (!/^postgres(ql)?:\/\//.test(url))
    throw new Error('DATABASE_URL must use postgresql:// or pglite:');
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = postgresDrizzle(client, { schema });
  return {
    db,
    raw: (query) => client.unsafe(query),
    transaction: (fn) => db.transaction(fn),
    close: () => client.end(),
  };
}
