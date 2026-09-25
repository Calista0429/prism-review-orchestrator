import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { defaultPolicy, type Evidence, type Intake } from '@prism/shared';
import { createDatabase, type DatabaseConnection } from './client';
import { migrate } from './migrate';
import { readConfig } from '../config';
import {
  policyVersions,
  pullRequests,
  repositories,
  reviewers,
  reviewerSkills,
} from './schema';
const evidence: Evidence = {
  filesChanged: 2,
  linesAdded: 18,
  linesDeleted: 6,
  ci: 'passed',
  hasMigration: false,
  sensitivePaths: [],
  ownerCoverage: true,
  repositoryCriticality: 'normal',
  paths: ['src/components/Card.css'],
  rollback: 'Revert the commit; no data changes.',
};
export const fixtures: (Intake & { id: string })[] = [
  {
    id: 'pr-dealer',
    repository: 'dealer-portal',
    number: 142,
    title: 'Refine spacing in dealer search results',
    description:
      'Adjust card padding and spacing to match the design system. No runtime behavior changes. Visual regression suite passes.',
    author: 'maya.chen',
    revision: 'a13f09b',
    evidence,
  },
  {
    id: 'pr-diagnostic',
    repository: 'diagnostic-gateway',
    number: 87,
    title: 'Update diagnostic session state transitions',
    description:
      'Change timeout handling and retry transitions in the vehicle diagnostic state machine. Requires domain-owner validation of degraded connectivity.',
    author: 'kenji.sato',
    revision: 'b28d11e',
    evidence: {
      ...evidence,
      filesChanged: 18,
      linesAdded: 384,
      linesDeleted: 142,
      repositoryCriticality: 'safety',
      sensitivePaths: ['src/diagnostics/state-machine.ts'],
      paths: ['src/diagnostics/state-machine.ts', 'tests/session.test.ts'],
      rollback: 'Revert firmware package through controlled fleet rollout.',
    },
  },
  {
    id: 'pr-telemetry',
    repository: 'plant-telemetry',
    number: 231,
    title: 'Migrate telemetry ingestion to partitioned storage',
    description:
      'Partition the production events table and update the ingestion writer. Backfill requires coordination; destructive down-migration is not available.',
    author: 'lena.weber',
    revision: 'c93d81a',
    evidence: {
      ...evidence,
      filesChanged: 24,
      linesAdded: 642,
      linesDeleted: 210,
      hasMigration: true,
      repositoryCriticality: 'high',
      paths: ['db/migrations/042_partitions.sql', 'src/ingestion/writer.ts'],
      rollback:
        'Restore snapshot and replay buffered events during a maintenance window.',
    },
  },
  {
    id: 'pr-configurator',
    repository: 'vehicle-configurator',
    number: 56,
    title: 'Upgrade configuration resolver dependency',
    description:
      'Update a major dependency. Release notes do not fully explain changed resolution precedence. Compatibility and transitive impact remain unclear.',
    author: 'alex.morgan',
    revision: 'd81f29c',
    evidence: {
      ...evidence,
      filesChanged: 4,
      linesAdded: 186,
      linesDeleted: 130,
      ci: 'pending',
      paths: ['package.json', 'pnpm-lock.yaml'],
      rollback: 'Pin the previous dependency version.',
    },
  },
  {
    id: 'pr-booking',
    repository: 'service-booking',
    number: 109,
    title: 'Validate appointment time and contact details',
    description:
      'Add shared form validation for appointment time and telephone number. Unit tests cover invalid entries and timezone boundaries.',
    author: 'nina.patel',
    revision: 'e73a26f',
    evidence: {
      ...evidence,
      filesChanged: 7,
      linesAdded: 164,
      linesDeleted: 32,
      paths: ['src/booking/validation.ts', 'tests/validation.test.ts'],
    },
  },
];
export async function seed(connection: DatabaseConnection) {
  await connection.transaction(async (db) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(8723462)`);
    await db
      .insert(policyVersions)
      .values({
        id: 'policy-v1',
        version: 1,
        policy: defaultPolicy,
        author: 'system',
      })
      .onConflictDoNothing();
    for (const fixture of fixtures) {
      await db
        .insert(repositories)
        .values({
          id: fixture.repository,
          name: fixture.repository,
          criticality: fixture.evidence.repositoryCriticality,
        })
        .onConflictDoNothing();
      const { repository, ...pr } = fixture;
      await db
        .insert(pullRequests)
        .values({ ...pr, repositoryId: repository })
        .onConflictDoNothing();
    }
    const people = [
      {
        id: 'r-aya',
        name: 'Aya Tanaka',
        username: 'aya.tanaka',
        capacity: 4,
        available: true,
        skills: ['general', 'domain', 'triage', 'database'],
      },
      {
        id: 'r-daniel',
        name: 'Daniel Fischer',
        username: 'daniel.fischer',
        capacity: 3,
        available: true,
        skills: ['general', 'domain', 'database', 'triage'],
      },
      {
        id: 'r-samira',
        name: 'Samira Ali',
        username: 'samira.ali',
        capacity: 4,
        available: true,
        skills: ['general', 'triage', 'security'],
      },
      {
        id: 'r-oliver',
        name: 'Oliver Braun',
        username: 'oliver.braun',
        capacity: 2,
        available: false,
        skills: ['general', 'domain'],
      },
    ];
    for (const { skills, ...person } of people) {
      await db.insert(reviewers).values(person).onConflictDoNothing();
      for (const skill of skills)
        await db
          .insert(reviewerSkills)
          .values({ reviewerId: person.id, skill })
          .onConflictDoNothing();
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const connection = await createDatabase(readConfig().DATABASE_URL);
  try {
    await migrate(connection);
    await seed(connection);
    console.log('Five demo pull requests seeded; existing history preserved.');
  } finally {
    await connection.close();
  }
}
