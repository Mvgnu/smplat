import { test, expect } from '@playwright/test';

async function resetReferrals(page: import('@playwright/test').Page) {
  const cancelButtons = page.getByTestId('referral-cancel');
  const count = await cancelButtons.count();
  for (let index = 0; index < count; index += 1) {
    await cancelButtons.nth(index).click();
  }
}

test.describe('Loyalty referrals hub', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/account/loyalty/referrals');
    await expect(page.getByTestId('referral-hub')).toBeVisible();
    await resetReferrals(page);
  });

  test('creates referral invite and shows success notice', async ({ page }) => {
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByTestId('referral-success')).toContainText('Referral invite created');
    await expect(page.getByTestId('referral-item')).toHaveCount(1);
  });

  test('prevents rapid-fire invites via cooldown messaging', async ({ page }) => {
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByTestId('referral-item')).toHaveCount(1);

    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByTestId('referral-error')).toContainText('Please wait');
  });

  test('cancels an active referral invite', async ({ page }) => {
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByTestId('referral-item')).toHaveCount(1);

    await page.getByTestId('referral-cancel').first().click();

    await expect(page.getByTestId('referral-success')).toContainText('cancelled');
  });
});
