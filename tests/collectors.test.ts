import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverJobkorea } from "../src/collectors.js";
import {
  collectionFailed,
  limitReason,
  collectionStatus,
} from "../src/collection-status.js";
import { collectionSummary } from "../src/collection-report.js";
import { parseCollectionOptions } from "../src/collection-options.js";
import type { Run } from "../src/model.js";

const run: Run = {
  at: "2026-11-23T00:00:00Z",
  success: false,
  complete: false,
  discovered: 0,
  fetched: 0,
  failed: 0,
  reason: null,
};

test("Jobkorea uses the public paging POST and reads fragment pagination", async (t) => {
  const requested: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(url, "https://www.jobkorea.co.kr/Recruit/Home/_GI_List/");
      assert.equal(options.method, "POST");
      const body = options.body as URLSearchParams;
      assert.equal(
        body.get("condition[duty]"),
        "1000229,1000231,1000239,1000423",
      );
      assert.equal(body.get("condition[menucode]"), "");
      const page = body.get("page")!;
      requested.push(page);
      return new Response(
        `<strong><a href="/Recruit/GI_Read/${page}">백엔드 개발자</a></strong>${page === "1" ? '<a data-page="2" href="/recruit/_GI_List?Page=2">2</a>' : ""}`,
      );
    },
  );
  assert.deepEqual(await discoverJobkorea(5), {
    ids: ["1", "2"],
    complete: true,
    reason: null,
  });
  assert.deepEqual(requested, ["1", "2"]);
});

test("a later listing failure preserves already discovered candidates", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response(
          '<strong><a href="/Recruit/GI_Read/1">백엔드 개발자</a></strong><a data-page="2">2</a>',
        )
      : new Response("Forbidden", { status: 403 }),
  );
  assert.deepEqual(await discoverJobkorea(5), {
    ids: ["1"],
    complete: false,
    reason: "listing-http-403",
  });
  assert.equal(calls, 2, "403 is not retried repeatedly");
});

test("repeated Jobkorea pages are errors, not successful end-of-list", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        '<strong><a href="/Recruit/GI_Read/1">백엔드 개발자</a></strong><a data-page="2">2</a>',
      ),
  );
  assert.deepEqual(await discoverJobkorea(5), {
    ids: ["1"],
    complete: false,
    reason: "repeated-page",
  });
});

test("reports distinguish blocked sources, partial progress, limits, and errors", () => {
  const blocked = {
    ...run,
    source: "jobkorea" as const,
    reason: "listing-http-403",
  };
  assert.equal(collectionStatus(blocked), "blocked");
  assert.equal(collectionStatus({ ...blocked, fetched: 1 }), "partial");
  assert.equal(
    collectionStatus({ ...run, success: true, complete: true }),
    "complete",
  );
  assert.equal(collectionFailed([blocked], true), true);
  assert.equal(
    collectionFailed([{ ...run, reason: "repeated-page" }], true),
    true,
  );
  assert.equal(
    collectionFailed([{ ...run, failed: 1, reason: "detail-failures" }], true),
    true,
  );
  assert.equal(
    collectionFailed([{ ...run, reason: "detail-limit" }], true),
    false,
  );
  assert.equal(collectionFailed([{ ...run, reason: "detail-limit" }]), true);
  assert.match(collectionSummary([blocked]), /잡코리아 \| 접근 차단/);
});

test("detail and time limits never hide an earlier listing failure", () => {
  assert.equal(limitReason("repeated-page", "detail-limit"), "repeated-page");
  assert.equal(
    limitReason("listing-http-403", "time-budget"),
    "listing-http-403",
  );
  assert.equal(limitReason("page-limit", "detail-limit"), "detail-limit");
  assert.equal(limitReason(null, "detail-limit"), "detail-limit");
});

test("collection CLI selects sources and rejects invalid limits", () => {
  assert.deepEqual(
    parseCollectionOptions([
      "--sources",
      "jobkorea,jobkorea",
      "--max-pages",
      "3",
      "--max-details",
      "0",
    ]),
    { sources: ["jobkorea"], maxPages: 3, maxDetails: undefined },
  );
  for (const args of [
    ["--sources", "other"],
    ["--sources", ""],
    ["--max-pages", "0"],
    ["--max-details", "-1"],
    ["--max-details", "NaN"],
    ["--max-pages"],
    ["--other", "1"],
  ])
    assert.throws(() => parseCollectionOptions(args));
});
