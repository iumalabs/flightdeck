// Split out from session.ts: playwright.config.ts imports this constant directly, and Playwright's
// config loader chokes on `jose`'s ESM-only build through its CJS require() interop path — keeping
// this file dependency-free (no `jose` import) avoids that entirely. session.ts (imported only by
// test files, which Playwright loads differently) re-exports this and adds the jose-based helper.
export const E2E_SESSION_SECRET = "e2e-only-secret-never-deployed";

// A fixed, test-only pepper for hashing sentry-cli-facing API tokens (specs/005-releases, T047) —
// never a real credential, mirrors E2E_SESSION_SECRET's role above for the contract suite's
// wrangler dev instance (playwright.contract.config.ts).
export const E2E_API_TOKEN_PEPPER = "e2e-only-pepper-never-deployed";
