import { test, expect } from '@playwright/test';

test.describe('Checkout loyalty intent bridge', () => {
  test('persists checkout plans into success and loyalty hub', async ({ page }) => {
    await page.route('**/api/checkout', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            payment: { checkout_url: '/checkout/success?order=TEST-ORDER-123' },
            order: { id: 'TEST-ORDER-123' }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/loyalty/checkout-intents', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route('**/api/onboarding/journeys/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'pending',
          referral_code: 'E2E-BYPASS',
          tasks: []
        })
      });
    });

    await page.route('**/api/analytics/onboarding-events', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/products/test-product');
    await page.locator('[data-testid="option-group"]').first().locator('input[type="checkbox"]').check();
    await page.locator('[data-testid="add-to-cart"]').click();
    await page.locator('[data-testid="cart-link"]').click();
    await page.locator('[data-testid="checkout-button"]').click();

    await page.getByTestId('name-input').fill('Playwright Tester');
    await page.getByTestId('email-input').fill('playwright@example.com');
    await page.getByTestId('company-input').fill('Playwright Labs');

    await page.getByTestId('plan-reward-social-boost').click();
    const referralToggle = page.getByTestId('plan-referral-toggle');
    if (await referralToggle.isEnabled()) {
      await referralToggle.check();
    }

    await page.getByTestId('submit-checkout').click();

    await expect(page.getByTestId('checkout-loyalty-actions')).toBeVisible();
    await expect(page.getByTestId('checkout-intent-redemption')).toBeVisible();
    await expect(page.getByTestId('checkout-intent-referral_share')).toBeVisible();

    await page.goto('/account/loyalty');
    const nextActionsSection = page.getByTestId('loyalty-next-actions');
    await expect(nextActionsSection).toBeVisible();

    const dismissButtons = nextActionsSection.getByRole('button', { name: 'Dismiss' });
    const buttonCount = await dismissButtons.count();
    for (let index = 0; index < buttonCount; index += 1) {
      await dismissButtons.nth(0).click();
    }

    await expect(nextActionsSection.locator('article')).toHaveCount(0);
  });
});
