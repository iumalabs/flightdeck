// Kept in sync with the root VERSION file by release-please (release-please-config.json's
// extra-files entry, matched via the marker comment below) — the Worker bundle has no filesystem
// access at request time, unlike the Vite frontend build (vite.config.ts reads VERSION directly),
// so this is the Worker-side equivalent: a plain importable constant, not a runtime file read.
export const APP_VERSION = "0.13.0"; // x-release-please-version
