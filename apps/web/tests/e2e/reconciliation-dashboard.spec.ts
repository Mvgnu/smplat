import { test, expect } from '@playwright/test';

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', 'finance@test.com');
  await page.locator('[data-testid="login-button"]').click();
};

test.describe('Billing Reconciliation Dashboard', () => {
  test('renders summary metrics and run history', async ({ page }) => {
    await login(page);

    await page.goto('/admin/billing/reconciliation');

    await expect(page.locator('[data-testid="reconciliation-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="reconciliation-summary"]')).toContainText('Staging backlog');
    await expect(page.locator('[data-testid="reconciliation-run-history"]')).toContainText('Run history');
    await expect(page.locator('[data-testid="reconciliation-run-history"]')).toContainText('failed');
    await expect(page.locator('[data-testid="reconciliation-discrepancies"]')).toContainText('Discrepancy log');
  });

  test('allows triaging and requeueing staged entries', async ({ page }) => {
    await page.route('**/api/billing/reconciliation/staging/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/triage')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'triaged', triageNote: 'Investigating metadata' }),
        });
        return;
      }
      if (url.endsWith('/requeue')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'requeued', triageNote: 'Retry sync', requeueCount: 2 }),
        });
        return;
      }
      await route.continue();
    });

    await login(page);
    await page.goto('/admin/billing/reconciliation');

    const stagingRow = page.locator('[data-testid="staging-row"][data-staging-id="stage-1"]');
    await expect(stagingRow).toBeVisible();

    const noteInput = stagingRow.locator('[data-testid="triage-note-input"]');
    await noteInput.fill('Investigating metadata');
    await expect(noteInput).toHaveValue('Investigating metadata');

    const triageResponse = page.waitForResponse((response) =>
      response.url().includes('/api/billing/reconciliation/staging/stage-1/triage') && response.request().method() === 'POST',
    );
    await stagingRow.locator('[data-action="triaged"]').click();
    await expect(await triageResponse).toBeTruthy();
    await expect(noteInput).toHaveValue('');

    const requeueResponse = page.waitForResponse((response) =>
      response.url().includes('/api/billing/reconciliation/staging/stage-1/requeue') && response.request().method() === 'POST',
    );
    await stagingRow.locator('[data-testid="requeue-action"]').click();
    await expect(await requeueResponse).toBeTruthy();
  });
});
