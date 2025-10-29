import { test, expect } from '@playwright/test';

test.describe('Loyalty hub', () => {
  test('creates redemption and shows optimistic balances', async ({ page }) => {
    await page.goto('/account/loyalty');

    await expect(page.getByTestId('loyalty-hub')).toBeVisible();

    const firstRewardButton = page.getByTestId('redeem-social-boost');
    await expect(firstRewardButton).toBeEnabled();

    await firstRewardButton.click();

    await expect(page.getByTestId('loyalty-success')).toBeVisible();
    await expect(firstRewardButton).toBeDisabled();
  });

  test('surfaces fallback error when redemption exceeds balance', async ({ page }) => {
    await page.goto('/account/loyalty');

    const expensiveReward = page.getByTestId('redeem-strategy-session');

    // Drain available balance by redeeming the lower cost reward first
    await page.getByTestId('redeem-social-boost').click();
    await expect(page.getByTestId('loyalty-success')).toBeVisible();

    await expensiveReward.click();
    await expect(page.getByTestId('loyalty-error')).toBeVisible();
  });
});
