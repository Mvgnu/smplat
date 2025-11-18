import { test, expect } from '@playwright/test';

import { signInAsAdmin } from '../utils/dev-auth';

test.describe('Admin telemetry banners', () => {
  test('reports surfaces export + follow-up telemetry banners', async ({ page }) => {
    await signInAsAdmin(page, '/admin/reports');

    await expect(page.getByTestId('workflow-telemetry-export-card')).toBeVisible();
    await expect(page.getByTestId('workflow-telemetry-followup-queue')).toBeVisible();
    const slackTelemetry = page.getByTestId('workflow-telemetry-slack-snippet');
    if ((await slackTelemetry.count()) > 0) {
      await expect(slackTelemetry.first()).toBeVisible();
    }
  });

  test('onboarding quick-order funnel renders workflow telemetry banner', async ({ page }) => {
    await signInAsAdmin(page, '/admin/onboarding');

    await expect(page.getByTestId('workflow-telemetry-onboarding-card')).toBeVisible();
    const providerDrawerTelemetry = page.getByTestId('workflow-telemetry-provider-drawer');
    if ((await providerDrawerTelemetry.count()) > 0) {
      await expect(providerDrawerTelemetry.first()).toBeVisible();
    }
  });
});
