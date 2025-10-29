import { test, expect } from '@playwright/test';

test.describe('Admin loyalty guardrail console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'admin@test.com');
    await page.locator('[data-testid="login-button"]').click();
    await page.goto('/admin/loyalty');
  });

  test('renders guardrail posture and applies override', async ({ page }) => {
    await expect(page.getByTestId('guardrail-console')).toBeVisible();
    await expect(page.getByTestId('guardrail-kpis')).toBeVisible();

    const rowCount = await page.getByRole('row').count();
    expect(rowCount).toBeGreaterThan(1);

    await page.getByTestId('guardrail-override-justification').fill('Launch window override');
    await page.getByTestId('guardrail-override-submit').click();

    await expect(page.getByTestId('guardrail-override-success')).toContainText('Override created');
  });
});
