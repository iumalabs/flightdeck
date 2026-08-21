import { assertEquals } from "@std/assert";
import { mintSession, verifySessionToken } from "../../worker/auth/session.ts";

const ENV = { SESSION_SECRET: "unit-test-secret-do-not-use-in-prod" };

Deno.test("mintSession + verifySessionToken round-trips sub/email/role", async () => {
  const token = await mintSession({ sub: "user-1", email: "a@example.com", role: "member" }, ENV);
  const identity = await verifySessionToken(token, ENV);
  assertEquals(identity, { sub: "user-1", email: "a@example.com", role: "member" });
});

Deno.test("verifySessionToken returns null for a tampered token", async () => {
  const token = await mintSession({ sub: "user-1", email: "a@example.com", role: "member" }, ENV);
  const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
  const identity = await verifySessionToken(tampered, ENV);
  assertEquals(identity, null);
});

Deno.test("verifySessionToken returns null for a token signed with a different secret", async () => {
  const token = await mintSession({ sub: "user-1", email: "a@example.com", role: "member" }, ENV);
  const identity = await verifySessionToken(token, {
    SESSION_SECRET: "a-completely-different-secret",
  });
  assertEquals(identity, null);
});

Deno.test("verifySessionToken returns null for garbage input", async () => {
  const identity = await verifySessionToken("not-a-jwt-at-all", ENV);
  assertEquals(identity, null);
});
