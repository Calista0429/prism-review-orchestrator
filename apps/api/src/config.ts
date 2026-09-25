import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
export const rootDirectory = fileURLToPath(
  new URL('../../../', import.meta.url),
);
config({ path: resolve(rootDirectory, '.env'), quiet: true });
export function readConfig() {
  const config = z
    .object({
      AI_PROVIDER: z.enum(['demo', 'openrouter']).default('demo'),
      JEV_MODEL: z.literal('typesafe/jev-1.13').default('typesafe/jev-1.13'),
      OPENROUTER_API_KEY: z.string().optional(),
      DATABASE_URL: z.string().default('pglite:./.data/prism'),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    })
    .parse(process.env);
  if (
    config.DATABASE_URL.startsWith('pglite:') &&
    config.DATABASE_URL !== 'pglite:memory'
  )
    config.DATABASE_URL = `pglite:${resolve(rootDirectory, config.DATABASE_URL.slice(7))}`;
  return config;
}
