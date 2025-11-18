import { test, expect } from '@playwright/test';

import { signInAsCustomer } from '../utils/dev-auth';

test.describe('Account telemetry banners', () => {
  test('quick-order trust snapshot surfaces workflow telemetry for customers', async ({ page }) => {
    await signInAsCustomer(page, '/account/orders');

    await expect(page.getByTestId('workflow-telemetry-account-card')).toBeVisible();
  });
});
