import { test, expect } from '@playwright/test';

async function signInAdmin(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/login?callbackUrl=%2Fadmin%2Forders');
  const devButton = page.getByTestId('dev-login-admin');
  await expect(devButton).toBeVisible();
  await devButton.click();
  await page.waitForURL('**/admin/orders', { waitUntil: 'load' });
}

test.describe('Admin orders', () => {
  test('renders provider telemetry for selected order', async ({ page }) => {
    await signInAdmin(page);

    const providerSection = page.getByTestId('admin-provider-automation').first();
    await expect(providerSection).toBeVisible();
    await expect(providerSection.getByText('Provider automation', { exact: true })).toBeVisible();
    await expect(providerSection.getByText('Scheduled pending', { exact: true })).toBeVisible();

    const providerCard = page.getByTestId('provider-order-card').first();
    await expect(providerCard).toBeVisible();
    await expect(providerCard.getByText(/Service /i)).toBeVisible();
    await expect(providerCard.getByText('Replay history')).toBeVisible();
  });
});
