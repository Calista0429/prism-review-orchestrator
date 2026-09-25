import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDatabase, type DatabaseConnection } from './client';
import { readConfig } from '../config';
export async function migrate(connection: DatabaseConnection) {
  const migration = await readFile(
    new URL('../../migrations/0001_initial.sql', import.meta.url),
    'utf8',
  );
  await connection.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8723461)`);
    await tx.execute(
      sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    // Execute each statement separately: both PostgreSQL drivers reject multiple prepared commands.
    await tx.execute(
      sql.raw(
        `DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1) THEN ${migration} INSERT INTO schema_migrations(version) VALUES (1); END IF; END $migration$;`,
      ),
    );
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const connection = await createDatabase(readConfig().DATABASE_URL);
  try {
    await migrate(connection);
    console.log('Database migrations applied.');
  } finally {
    await connection.close();
  }
}
