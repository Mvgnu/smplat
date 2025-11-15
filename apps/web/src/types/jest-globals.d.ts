declare module "@jest/globals" {
  export const describe: typeof globalThis.describe;
  export const fdescribe: typeof globalThis.fdescribe;
  export const xdescribe: typeof globalThis.xdescribe;
  export const it: typeof globalThis.it;
  export const fit: typeof globalThis.fit;
  export const xit: typeof globalThis.xit;
  export const test: typeof globalThis.test;
  export const xtest: typeof globalThis.xtest;
  export const beforeAll: typeof globalThis.beforeAll;
  export const beforeEach: typeof globalThis.beforeEach;
  export const afterAll: typeof globalThis.afterAll;
  export const afterEach: typeof globalThis.afterEach;
  export const expect: typeof globalThis.expect;
  export const jest: typeof globalThis.jest;
}
