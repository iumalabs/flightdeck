import { E2E_SESSION_SECRET } from "./constants.ts";

export { E2E_SESSION_SECRET };

function base64url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

// Hand-rolled HS256 JWT signing via Web Crypto — deliberately NOT `jose` here. `jose`'s ESM-only
// build fails to load through Playwright's CJS require() interop when tests run under
// `deno run -A npm:playwright test` (confirmed live: "Cannot resolve module ./jwe/compact/
// decrypt.js"), even though the identical import works fine inside the Worker itself (a real ESM
// context, not this CJS-interop path). The output is a standard, spec-compliant HS256 JWT — jose's
// jwtVerify on the server side (worker/auth/session.ts) doesn't care how it was constructed.
export async function mintTestSession(
  identity: { sub: string; email: string; role: string },
): Promise<string> {
  const header = { alg: "HS256" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: identity.sub,
    email: identity.email,
    role: identity.role,
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60 * 24,
  };

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(E2E_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
