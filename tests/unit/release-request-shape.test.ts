import { assertEquals } from "@std/assert";
import {
  commitsToRows,
  isProjectAuthorized,
  isProjectSlugAuthorized,
} from "../../worker/modules/releases/request-shape.ts";

Deno.test("isProjectAuthorized accepts when the token's project is among the requested projects", () => {
  assertEquals(isProjectAuthorized("demo", ["demo", "other-project"]), true);
});

Deno.test("isProjectAuthorized rejects when the token's project is not requested", () => {
  assertEquals(isProjectAuthorized("demo", ["other-project"]), false);
});

Deno.test("isProjectAuthorized rejects an empty projects array", () => {
  assertEquals(isProjectAuthorized("demo", []), false);
});

Deno.test("isProjectSlugAuthorized accepts when the URL project slug matches the token's project", () => {
  assertEquals(isProjectSlugAuthorized("demo", "demo"), true);
});

Deno.test("isProjectSlugAuthorized rejects a project slug the token isn't scoped to", () => {
  assertEquals(isProjectSlugAuthorized("demo", "other-project"), false);
});

Deno.test("commitsToRows maps sentry-cli's commit shape to release_commits rows", () => {
  const rows = commitsToRows([
    { id: "abc123", message: "fix bug", author_name: "Jane" },
    { id: "def456", message: "add feature" },
  ]);
  assertEquals(rows, [
    { sha: "abc123", message: "fix bug", author: "Jane" },
    { sha: "def456", message: "add feature", author: null },
  ]);
});

Deno.test("commitsToRows drops commits with no id (sha) — nothing meaningful to store", () => {
  const rows = commitsToRows([{ message: "no sha here" }, { id: "real-sha" }]);
  assertEquals(rows, [{ sha: "real-sha", message: null, author: null }]);
});
