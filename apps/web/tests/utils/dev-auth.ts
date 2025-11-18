import type { Page } from '@playwright/test';

type DevShortcutUser = 'admin' | 'customer' | 'testing' | 'analysis';

async function waitForTargetPath(page: Page, targetPath: string) {
  try {
    await page.waitForURL(
      (url) => {
        try {
          const parsed = new URL(url);
          return parsed.pathname.startsWith(targetPath);
        } catch {
          return false;
        }
      },
      { waitUntil: 'load', timeout: 20_000 },
    );
  } catch {
    await page.goto(targetPath);
    await page.waitForLoadState('networkidle');
  }
}

export async function signInWithDevShortcut(
  page: Page,
  userKey: DevShortcutUser,
  redirectPath: string,
): Promise<void> {
  const encodedCallback = encodeURIComponent(redirectPath);
  await page.goto(`/login?callbackUrl=${encodedCallback}`);
  const loginButton = page.getByTestId(`dev-login-${userKey}`);
  await loginButton.waitFor({ state: 'visible' });
  await loginButton.click();
  await waitForTargetPath(page, redirectPath);
  const currentPathname = (() => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return null;
    }
  })();
  if (!currentPathname || !currentPathname.startsWith(redirectPath)) {
    await page.goto(redirectPath);
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(500);
}

export function signInAsAdmin(page: Page, redirectPath = '/admin/reports'): Promise<void> {
  return signInWithDevShortcut(page, 'admin', redirectPath);
}

export function signInAsCustomer(page: Page, redirectPath = '/account/orders'): Promise<void> {
  return signInWithDevShortcut(page, 'customer', redirectPath);
}
