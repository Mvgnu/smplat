import { test, expect } from '@playwright/test';

test.describe('Checkout Flow', () => {
  test('should complete full checkout process', async ({ page }) => {
    // Start with a product in cart
    await page.goto('/products/test-product');
    await page.locator('[data-testid="option-group"]').first().locator('input[type="checkbox"]').check();
    await page.locator('[data-testid="add-to-cart"]').click();
    await expect(page.locator('[data-testid="cart-notification"]')).toBeVisible();

    // Go to cart
    await page.locator('[data-testid="cart-link"]').click();
    await expect(page.locator('[data-testid="cart-page"]')).toBeVisible();

    // Proceed to checkout
    await page.locator('[data-testid="checkout-button"]').click();
    await expect(page.locator('[data-testid="checkout-page"]')).toBeVisible();

    // Fill out checkout form
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="name-input"]', 'Test User');
    await page.fill('[data-testid="company-input"]', 'Test Company');

    // Submit checkout
    await page.locator('[data-testid="submit-checkout"]').click();

    // Check for success state or redirect to payment
    await expect(
      page.locator('[data-testid="checkout-success"], [data-testid="payment-page"]')
    ).toBeVisible();
  });

  test('should handle checkout validation errors', async ({ page }) => {
    await page.goto('/checkout');

    // Try to submit without required fields
    await page.locator('[data-testid="submit-checkout"]').click();

    // Check for validation errors
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible();

    // Check specific field errors
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();
  });

  test('should handle Stripe payment flow', async ({ page }) => {
    // This test would need Stripe test keys in environment
    // For now, just test the payment page loads
    await page.goto('/checkout');

    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="name-input"]', 'Test User');
    await page.fill('[data-testid="company-input"]', 'Test Company');

    await page.locator('[data-testid="submit-checkout"]').click();

    // Should redirect to Stripe or show payment form
    await expect(
      page.locator('[data-testid="stripe-payment"], [data-testid="payment-success"]')
    ).toBeVisible();
  });
});
