import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

for (const [repository, route] of [
  ['dealer-portal', 'Fast lane'],
  ['diagnostic-gateway', 'Critical'],
  ['vehicle-configurator', 'Needs triage'],
] as const) {
  test(`${repository} moves to ${route}`, async ({ page }) => {
    await page.goto('/');
    const incoming = page.getByRole('region', {
      name: 'Incoming lane',
      exact: true,
    });
    const card = incoming.getByRole('article').filter({ hasText: repository });
    await card.getByRole('button', { name: 'Run triage', exact: true }).click();
    const destination = page.getByRole('region', {
      name: `${route} lane`,
      exact: true,
    });
    await expect(
      destination.getByRole('article').filter({ hasText: repository }),
    ).toBeVisible();
    await expect(
      incoming.getByRole('article').filter({ hasText: repository }),
    ).toHaveCount(0);
  });
}

test('an override requires a reason and records its audit history', async ({
  page,
}) => {
  await page.goto('/pull-requests/pr-configurator');
  await expect(
    page.getByRole('heading', { name: 'Manual override' }),
  ).toBeVisible();
  const submit = page.getByRole('button', { name: 'Apply override' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Override reason').fill('   ');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Override route').selectOption('standard');
  await page
    .getByLabel('Override reason')
    .fill('Dependency owner confirmed compatibility in staging.');
  await submit.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Override recorded' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Audit history' }),
  ).toContainText('Dependency owner confirmed compatibility in staging.');
  await page.goto('/audit');
  await page.getByLabel('PR ID').fill('pr-configurator');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByRole('region', { name: 'Audit events' }),
  ).toContainText('Dependency owner confirmed compatibility in staging.');
});

test('simulation leaves the published policy unchanged and invalidates stale previews', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/policies/current')).json();
  await page.goto('/policies');
  await expect(
    page.getByRole('button', { name: 'Publish policy' }),
  ).toBeDisabled();
  await page.getByLabel('Fast lane threshold').fill('2');
  await page.getByRole('button', { name: 'Simulate draft' }).click();
  await expect(
    page.getByRole('heading', { name: 'Simulation preview' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publish policy' }),
  ).toBeEnabled();
  expect(await (await request.get('/api/policies/current')).json()).toEqual(
    before,
  );
  await page.getByLabel('Fast lane threshold').fill('2.5');
  await expect(
    page.getByRole('button', { name: 'Publish policy' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Simulation preview' }),
  ).toHaveCount(0);
});

test('publishing creates a new policy version without rewriting previous decisions', async ({
  page,
  request,
}) => {
  const previousPolicy = await (
    await request.get('/api/policies/current')
  ).json();
  const previousDetail = await (
    await request.get('/api/pull-requests/pr-dealer')
  ).json();
  await page.goto('/policies');
  await page.getByLabel('Fast lane threshold').fill('2');
  await page.getByRole('button', { name: 'Simulate draft' }).click();
  await expect(
    page.getByRole('button', { name: 'Publish policy' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Publish policy' }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: `Policy version ${previousPolicy.version + 1} published`,
    }),
  ).toBeVisible();
  const published = await (await request.get('/api/policies/current')).json();
  expect(published.version).toBe(previousPolicy.version + 1);
  expect(published.policy.fastThreshold).toBe(2);
  expect(
    (await (await request.get('/api/pull-requests/pr-dealer')).json())
      .decisions,
  ).toEqual(previousDetail.decisions);
  await expect(
    page.getByRole('button', { name: 'Publish policy' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Simulation preview' }),
  ).toHaveCount(0);
});

test('workspace routes fit laptop and narrow screens', async ({
  page,
}, testInfo) => {
  const views = [
    ['board', '/', 'Command center'],
    ['detail', '/pull-requests/pr-diagnostic', 'Risk assessment'],
    ['policies', '/policies', 'Policy simulator'],
    ['audit', '/audit', 'Audit trail'],
  ] as const;
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path, heading] of views) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible();
      if (name === 'board')
        await expect(
          page.getByRole('region', { name: 'Fast lane lane', exact: true }),
        ).toBeAttached();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      if (width !== 1024)
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${width}.png`),
          fullPage: true,
        });
    }
  }
});

test('captures the command center portfolio screenshot', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Incoming lane', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Incoming lane', exact: true })
      .getByRole('article'),
  ).toHaveCount(5);
  await page.screenshot({
    path: 'docs/screenshots/prism-command-center.png',
    fullPage: true,
  });
  await expect(
    page.getByRole('heading', { name: 'Command center', exact: true }),
  ).toBeVisible();
});
