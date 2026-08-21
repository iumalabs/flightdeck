// Split out from session.ts: playwright.config.ts imports this constant directly, and Playwright's
// config loader chokes on `jose`'s ESM-only build through its CJS require() interop path — keeping
// this file dependency-free (no `jose` import) avoids that entirely. session.ts (imported only by
// test files, which Playwright loads differently) re-exports this and adds the jose-based helper.
export const E2E_SESSION_SECRET = "e2e-only-secret-never-deployed";
