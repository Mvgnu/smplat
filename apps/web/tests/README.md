# Frontend Testing Suite

This directory contains comprehensive tests for the SMPLAT web application, covering both unit tests and end-to-end user journey tests.

## Test Structure

```
tests/
├── e2e/                    # End-to-end tests using Playwright
│   ├── authentication.spec.ts    # Login/logout flows
│   ├── checkout-flow.spec.ts     # Complete checkout process
│   ├── product-configurator.spec.ts  # Product configuration
│   └── admin-orders.spec.ts      # Admin order management
└── README.md               # This file
```

## Testing Tools

### Playwright (E2E Tests)
- **Framework**: Playwright for reliable end-to-end testing
- **Browsers**: Tests run on Chromium, Firefox, Safari, and mobile viewports
- **Features**: Auto-retry, visual debugging, trace collection

### Jest + React Testing Library (Unit Tests)
- **Framework**: Jest for unit testing React components
- **Library**: React Testing Library for component interaction testing
- **Environment**: jsdom for DOM simulation

## Running Tests

### All Tests
```bash
pnpm test                    # Run all Playwright tests
pnpm run test:unit          # Run all Jest unit tests
```

### E2E Tests (Playwright)
```bash
# Run all E2E tests
pnpm test

# Run in headed mode (see browser)
pnpm run test:headed

# Run with UI mode
pnpm run test:ui

# Debug failing tests
pnpm run test:debug

# Run specific test file
pnpm test authentication.spec.ts

# Run tests matching pattern
pnpm test --grep "checkout"
```

### Unit Tests (Jest)
```bash
# Run all unit tests
pnpm run test:unit

# Run in watch mode
pnpm run test:unit:watch

# Run with coverage
pnpm run test:unit:coverage

# Run specific test file
pnpm run test:unit cart.test.ts
```

## Test Categories

### Critical User Flows (E2E Priority)
1. **Product Configuration & Purchase** - Complex pricing logic, form validation
2. **Checkout Process** - Payment integration, data validation
3. **Authentication** - Login flow, session management
4. **Admin Order Management** - CRUD operations, status updates

### Component Logic (Unit Test Priority)
1. **Cart Management** - State management, calculations
2. **Product Configurator** - Price calculations, option selection
3. **Form Components** - Validation, user input handling

## Writing Tests

### E2E Test Guidelines
- Use data-testid attributes for reliable element selection
- Test complete user journeys, not just individual pages
- Include both happy path and error scenarios
- Use realistic test data
- Add assertions for visual feedback (notifications, loading states)

### Unit Test Guidelines
- Test component behavior, not implementation details
- Mock external dependencies (API calls, localStorage)
- Test both user interactions and prop changes
- Use descriptive test names that explain the behavior being tested

## Test Data Setup

For tests requiring authenticated state or seeded data, use Playwright's fixtures or setup functions:

```typescript
// Example: Authentication setup
test.beforeEach(async ({ page }) => {
  // Login as admin user
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', 'admin@test.com');
  await page.click('[data-testid="login-button"]');
});
```

## CI Integration

Tests are configured to run in CI environments with:
- Headless browser execution
- Retry logic for flaky tests
- Coverage reporting
- Parallel execution where possible

## Debugging

### Playwright
- Use `--headed` flag to see browser actions
- Use `--debug` flag to step through tests
- Use `--ui` flag for visual test runner
- Traces are automatically collected on failures

### Jest
- Use `--watch` mode for interactive development
- Use `--coverage` to see test coverage
- Use `--verbose` for detailed test output

## Best Practices

1. **Test the user experience**, not implementation details
2. **Write tests before fixing bugs** to prevent regressions
3. **Keep tests fast** - avoid unnecessary waits or complex setup
4. **Use descriptive names** that explain what behavior is being tested
5. **Test both success and failure scenarios**
6. **Regularly review and update tests** as features evolve

## Coverage Goals

- **Critical user flows**: 100% coverage (product config, checkout, admin)
- **Component logic**: 80% coverage for complex components
- **Error handling**: All error paths should be tested
