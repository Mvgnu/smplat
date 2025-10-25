import { test, expect } from '@playwright/test';

test.describe('Admin Order Management', () => {
  test('should display orders in admin panel', async ({ page }) => {
    // Login as admin (this would need proper auth setup in test environment)
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'admin@test.com');
    await page.locator('[data-testid="login-button"]').click();

    // Navigate to admin orders
    await page.goto('/admin/orders');
    await expect(page.locator('[data-testid="orders-page"]')).toBeVisible();

    // Check if orders table is present
    await expect(page.locator('[data-testid="orders-table"]')).toBeVisible();

    // Check for order status indicators
    await expect(page.locator('[data-testid="order-status"]')).toBeVisible();
  });

  test('should allow order status updates', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'admin@test.com');
    await page.locator('[data-testid="login-button"]').click();

    await page.goto('/admin/orders');

    // Find first order and update status
    const firstOrderStatus = await page.locator('[data-testid="order-status"]').first().textContent();

    // Click status form
    await page.locator('[data-testid="status-form"]').first().click();

    // Change status
    await page.selectOption('[data-testid="status-select"]', 'completed');
    await page.locator('[data-testid="update-status"]').click();

    // Check if status changed
    const updatedStatus = await page.locator('[data-testid="order-status"]').first().textContent();
    expect(updatedStatus).not.toBe(firstOrderStatus);
  });

  test('should display order details and fulfillment progress', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'admin@test.com');
    await page.locator('[data-testid="login-button"]').click();

    await page.goto('/admin/orders');

    // Click on first order to view details
    await page.locator('[data-testid="order-row"]').first().click();

    // Check order details section
    await expect(page.locator('[data-testid="order-details"]')).toBeVisible();

    // Check fulfillment progress
    await expect(page.locator('[data-testid="fulfillment-progress"]')).toBeVisible();

    // Check order items
    await expect(page.locator('[data-testid="order-items"]')).toBeVisible();
  });
});
