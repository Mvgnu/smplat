import { test, expect } from '@playwright/test';

async function signInViaDevShortcut(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/login?callbackUrl=%2Faccount%2Forders');
  const devButton = page.getByTestId('dev-login-customer');
  await expect(devButton).toBeVisible();
  await devButton.click();
  await page.waitForURL('**/account/orders', { waitUntil: 'load' });
}

test.describe('Account orders', () => {
  test('surfaces provider automation telemetry from mock orders', async ({ page }) => {
    await signInViaDevShortcut(page);

    const providerSection = page.getByTestId('account-provider-automation').first();
    await expect(providerSection).toBeVisible();
    await expect(providerSection.getByText('Provider automation', { exact: false })).toBeVisible();
    await expect(providerSection.getByText('Automation Labs')).toBeVisible();
    await expect(providerSection.getByText('Scheduled pending')).toBeVisible();
    const providerCard = providerSection.getByTestId('account-provider-order-card').first();
    await expect(providerCard.getByText('Manual refills')).toBeVisible();
    await expect(providerCard.getByText('Replay history')).toBeVisible();
  });
});
