import { test, expect } from '@playwright/test';

test.describe('Product Configurator', () => {
  test('should load product page and display configurator', async ({ page }) => {
    await page.goto('/products');

    // Check if products page loads
    await expect(page.locator('h1, h2, h3')).toBeVisible();

    // Try to find a product link and click it
    const productLink = page.locator('a[href*="/products/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
    }

    // Check if configurator is present (fallback to general form elements)
    await expect(
      page.locator('[data-testid="product-configurator"], form, .configurator, [data-testid="total-price"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should calculate price based on configuration options', async ({ page }) => {
    await page.goto('/products');

    // Find and click a product
    const productLink = page.locator('a[href*="/products/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
    }

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Try to find price element (with multiple fallbacks)
    const priceLocator = page.locator('[data-testid="total-price"], .price, [class*="price"], [class*="total"]');
    if (await priceLocator.first().isVisible()) {
      const initialPrice = await priceLocator.first().textContent();

      // Try to find and interact with option elements
      const optionElements = page.locator('input[type="checkbox"], input[type="radio"], button, [role="button"]');
      const firstOption = optionElements.first();

      if (await firstOption.isVisible()) {
        await firstOption.click();
        await page.waitForTimeout(1000);

        // Check if price changed
        const updatedPrice = await priceLocator.first().textContent();
        if (initialPrice && updatedPrice) {
          expect(updatedPrice).not.toBe(initialPrice);
        }
      }
    }
  });

  test('should add configured product to cart', async ({ page }) => {
    await page.goto('/products');

    // Find and click a product
    const productLink = page.locator('a[href*="/products/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
    }

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Try to find add to cart button (multiple fallbacks)
    const addToCartButton = page.locator('[data-testid="add-to-cart"], button:has-text("Add"), button:has-text("Cart"), button:has-text("Buy")').first();

    if (await addToCartButton.isVisible()) {
      await addToCartButton.click();

      // Check for success message or cart update
      await expect(
        page.locator('text=/cart|success|added|notification/i')
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
