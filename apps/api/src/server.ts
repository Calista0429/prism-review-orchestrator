import { buildApp } from './app';
import { readConfig } from './config';
import { createDatabase } from './db/client';
import { migrate } from './db/migrate';
import { seed } from './db/seed';
import { createProvider } from './providers';
const config = readConfig();
const provider = createProvider({
  mode: config.AI_PROVIDER,
  apiKey: config.OPENROUTER_API_KEY,
  model: config.JEV_MODEL,
});
const database = await createDatabase(config.DATABASE_URL);
try {
  await migrate(database);
  await seed(database);
  const app = buildApp(database, provider);
  const shutdown = async () => {
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await app.listen({ host: '127.0.0.1', port: config.PORT });
  console.log(
    `PRISM API listening at http://127.0.0.1:${config.PORT} (${provider.name} assessments)`,
  );
} catch {
  await database.close();
  console.error(
    'PRISM startup failed. Check database configuration and migrations.',
  );
  process.exitCode = 1;
}
