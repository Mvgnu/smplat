import { test, expect } from '@playwright/test';

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', 'finance@test.com');
  await page.locator('[data-testid="login-button"]').click();
};

test.describe('Billing Replay Console', () => {
  test('renders replay dashboard with filters', async ({ page }) => {
    await login(page);

    await page.goto('/admin/billing/reconciliation/replays');

    await expect(page.locator('[data-testid="replay-console-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-dashboard"]')).toBeVisible();
    await expect(page.getByText('Processor replay console')).toBeVisible();
    await expect(page.getByLabel('Provider')).toBeVisible();
    await expect(page.getByLabel('Replay status')).toBeVisible();
    await expect(page.getByPlaceholder('Search by correlation or invoice ID')).toBeVisible();
    await expect(page.getByText('Invoice INV-1001 missing')).toBeVisible();
  });

  test('supports replay trigger with force fallback', async ({ page }) => {
    await page.route('**/api/billing/replays/evt-1', async (route, request) => {
      const body = request.postDataJSON?.() ?? {};
      if (body.force) {
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            event: {
              id: 'evt-1',
              provider: 'stripe',
              externalId: 'evt_test_1',
              correlationId: 'inv_test_1',
              workspaceId: 'ws_test',
              invoiceId: 'inv_test_1',
              replayRequested: true,
              replayRequestedAt: new Date().toISOString(),
              replayAttempts: 3,
              replayedAt: null,
              lastReplayError: null,
              receivedAt: '2024-01-01T00:00:00.000Z',
              createdAt: '2024-01-01T00:00:00.000Z',
              status: 'queued',
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Replay limit reached' }),
      });
    });

    await login(page);
    await page.goto('/admin/billing/reconciliation/replays');

    const row = page.locator('tr', { hasText: 'evt_test_1' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Trigger replay' }).click();
    await expect(row.getByText('Replay limit reached')).toBeVisible();

    await row.getByRole('button', { name: 'Force replay' }).click();
    await expect(row.getByText('Force replay queued')).toBeVisible();
  });
});
