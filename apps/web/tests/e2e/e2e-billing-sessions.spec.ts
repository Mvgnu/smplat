import { test, expect } from '@playwright/test';

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', 'client@test.com');
  await page.locator('[data-testid="login-button"]').click();
};

test.describe('Client billing hosted sessions', () => {
  test('renders hosted session analytics and actions', async ({ page }) => {
    await page.route('**/api/v1/billing/invoices?workspace_id=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          invoices: [
            {
              id: 'inv-1',
              invoice_number: 'INV-1',
              status: 'issued',
              currency: 'EUR',
              subtotal: 100,
              tax: 0,
              total: 100,
              balance_due: 100,
              paymentIntentId: null,
              externalProcessorId: null,
              settlementAt: null,
              adjustmentsTotal: 0,
              adjustments: [],
              paymentTimeline: [],
              issued_at: new Date().toISOString(),
              due_at: new Date().toISOString(),
              paid_at: null,
              memo: null,
              line_items: [],
            },
          ],
          summary: {
            currency: 'EUR',
            outstanding_total: 100,
            overdue_total: 0,
            paid_total: 0,
          },
          aging: {
            current: 100,
            thirty: 0,
            sixty: 0,
            ninetyPlus: 0,
          },
        }),
      });
    });

    await page.route('**/api/v1/billing/reports?workspaceId=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workspaceId: 'ws-1',
          generatedAt: new Date().toISOString(),
          windowStart: new Date(Date.now() - 3600 * 1000).toISOString(),
          windowEnd: new Date().toISOString(),
          lookbackDays: 1,
          metrics: {
            total: 2,
            statusCounts: {
              completed: 1,
              failed: 1,
            },
            conversionRate: 0.5,
            abandonmentRate: 0.5,
            averageCompletionSeconds: 1200,
            averageRetryCount: 1.5,
            sessionsWithRetries: 1,
            averageRetryLatencySeconds: 300,
            pendingRegeneration: 1,
          },
          abandonmentReasons: [
            { reason: 'processor_card_declined', count: 1 },
          ],
          invoiceStatuses: [
            { status: 'issued', count: 1 },
            { status: 'paid', count: 1 },
          ],
        }),
      });
    });

    await login(page);
    await page.goto('/dashboard');

    await expect(page.locator('[data-testid="hosted-session-journey"]')).toBeVisible();
    await expect(page.getByText('Hosted checkout journey')).toBeVisible();
    await expect(page.getByText('Regenerate stalled sessions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Force regeneration sweep' })).toBeVisible();
  });
});
