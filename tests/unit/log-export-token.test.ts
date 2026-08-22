import { assertEquals, assertExists } from "@std/assert";
import {
  createExportToken,
  getOrCreateProjectBucket,
} from "../../worker/modules/logs/r2-provision.ts";

// Verifies REQUEST CONSTRUCTION against Cloudflare's real, documented API shape (research.md §8)
// via a mocked fetch — this module's live behavior against a real Cloudflare account is explicitly
// NOT verified by automated tests (no CLOUDFLARE_R2_ADMIN_TOKEN with R2 admin scope is available in
// this project's automated test environment), consistent with this project's established pattern of
// reserving some verifications for human-run validation (e.g. Module 5's real sentry-cli step).

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function withMockedFetch<T>(
  handler: (url: string, init: RequestInit | undefined) => Response,
  run: (calls: RecordedCall[]) => Promise<T>,
): Promise<T> {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("getOrCreateProjectBucket checks for the bucket, then creates it if missing", async () => {
  await withMockedFetch(
    (url) => {
      if (url.includes("/r2/buckets/") && !url.endsWith("/r2/buckets")) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
    async (calls) => {
      const bucket = await getOrCreateProjectBucket("acct123", "admin-token", "demo");
      assertEquals(bucket, "flightdeck-export-demo");
      assertEquals(calls[0].method, "GET");
      assertEquals(calls[0].url.includes("acct123"), true);
      assertEquals(calls[1].method, "POST");
      assertEquals(
        calls[1].url,
        "https://api.cloudflare.com/client/v4/accounts/acct123/r2/buckets",
      );
      assertEquals(calls[1].body, { name: "flightdeck-export-demo" });
    },
  );
});

Deno.test("getOrCreateProjectBucket does not attempt creation when the bucket already exists", async () => {
  await withMockedFetch(
    () =>
      new Response(JSON.stringify({ result: { name: "flightdeck-export-demo" } }), { status: 200 }),
    async (calls) => {
      await getOrCreateProjectBucket("acct123", "admin-token", "demo");
      assertEquals(calls.length, 1); // only the existence check, no create call
    },
  );
});

Deno.test("createExportToken constructs a bucket-scoped, Object-Read-only token request", async () => {
  await withMockedFetch(
    (url) => {
      if (url.endsWith("/permission_groups")) {
        return new Response(
          JSON.stringify({
            result: [
              { id: "read-group-id", name: "Workers R2 Storage Bucket Item Read" },
              { id: "write-group-id", name: "Workers R2 Storage Bucket Item Write" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ result: { id: "token-id-123", value: "secret-token-value" } }),
        { status: 200 },
      );
    },
    async (calls) => {
      const credential = await createExportToken(
        "acct123",
        "admin-token",
        "flightdeck-export-demo",
      );
      assertExists(credential);
      assertEquals(credential!.accessKeyId, "token-id-123");
      assertEquals(credential!.bucket, "flightdeck-export-demo");
      assertEquals(credential!.endpoint, "https://acct123.r2.cloudflarestorage.com");

      const createCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/tokens"));
      assertExists(createCall);
      // deno-lint-ignore no-explicit-any
      const body = createCall!.body as any;
      assertEquals(body.policies[0].permission_groups[0].id, "read-group-id");
      assertEquals(
        body.policies[0].permission_groups[0].name,
        "Workers R2 Storage Bucket Item Read",
      );
      assertEquals(
        Object.keys(body.policies[0].resources)[0],
        "com.cloudflare.edge.r2.bucket.acct123_default_flightdeck-export-demo",
      );
    },
  );
});

Deno.test("createExportToken's secretAccessKey is derived, never the raw token value", async () => {
  await withMockedFetch(
    (url) => {
      if (url.endsWith("/permission_groups")) {
        return new Response(
          JSON.stringify({ result: [{ id: "g1", name: "Workers R2 Storage Bucket Item Read" }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ result: { id: "id1", value: "raw-secret" } }), {
        status: 200,
      });
    },
    async () => {
      const credential = await createExportToken("acct123", "admin-token", "bucket1");
      assertExists(credential);
      assertEquals(credential!.secretAccessKey === "raw-secret", false);
      assertEquals(credential!.secretAccessKey.length, 64); // SHA-256 hex digest length
    },
  );
});

Deno.test("createExportToken returns null when no matching permission group is found", async () => {
  await withMockedFetch(
    (url) => {
      if (url.endsWith("/permission_groups")) {
        return new Response(JSON.stringify({ result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    },
    async () => {
      const credential = await createExportToken("acct123", "admin-token", "bucket1");
      assertEquals(credential, null);
    },
  );
});
