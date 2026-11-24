import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverJobkorea,
  discoverWanted,
  parseWantedApi,
} from "../src/collectors.js";
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

test("Wanted follows API next links and filters unrelated positions", async (t) => {
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(url);
    return Response.json(
      requested.length === 1
        ? {
            data: [
              { id: 1, position: "백엔드 개발자" },
              { id: 2, position: "마케터" },
            ],
            links: { next: "/api/v4/jobs?offset=100&limit=100" },
          }
        : {
            data: [{ id: 3, position: "풀스택 개발자" }],
            links: { next: null },
          },
    );
  });
  assert.deepEqual(await discoverWanted(5), {
    ids: ["1", "3"],
    complete: true,
    reason: null,
  });
  assert.equal(
    requested[1],
    "https://www.wanted.co.kr/api/v4/jobs?offset=100&limit=100",
  );
});

test("a later listing failure preserves already discovered candidates", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? Response.json({
          data: [{ id: 1, position: "백엔드 개발자" }],
          links: { next: "/api/v4/jobs?offset=100" },
        })
      : new Response("Forbidden", { status: 403 }),
  );
  assert.deepEqual(await discoverWanted(5), {
    ids: ["1"],
    complete: false,
    reason: "listing-http-403",
  });
  assert.equal(calls, 2, "403 is not retried repeatedly");
});

test("Wanted refuses pagination to another host", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: [{ id: 1, position: "백엔드 개발자" }],
      links: { next: "https://example.com/api/v4/jobs" },
    }),
  );
  assert.equal((await discoverWanted(2)).reason, "listing-failed");
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

test("Wanted API selects public job fields and validates identity", () => {
  const input = {
    job: {
      id: 123,
      position: "백엔드 개발자",
      company: { id: 9, name: "Example" },
      detail: {
        main_tasks: "Python API 개발",
        requirements: "문의 example@example.org",
      },
      annual_from: 2,
      annual_to: 5,
      status: "active",
      address: { location: "서울", full_location: "강남구" },
      is_bookmark: true,
    },
  };
  const job = parseWantedApi(input, "123");
  assert.equal(job.companyId, "9");
  assert.equal(job.minYears, 2);
  assert.equal(job.maxYears, 5);
  assert.equal(job.status, "open");
  assert.equal(job.location, "서울 강남구");
  assert.ok(!job.description.includes("example@example.org"));
  assert.ok(!("is_bookmark" in job));
  assert.throws(() => parseWantedApi(input, "999"));
  assert.throws(() => parseWantedApi({ job: {} }, "123"));
});

test("reports distinguish blocked sources, partial progress, limits, and errors", () => {
  const blocked = {
    ...run,
    source: "wanted" as const,
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
  assert.match(collectionSummary([blocked]), /원티드 \| 접근 차단/);
  assert.match(
    collectionSummary([blocked]),
    /잡코리아는 수집 대상으로 선택되지 않아 갱신하지 않았습니다/,
  );
  assert.match(
    collectionSummary([
      { ...run, source: "jobkorea", reason: "time-budget", fetched: 473 },
    ]),
    /원티드는 수집 대상으로 선택되지 않아 갱신하지 않았습니다/,
  );
  assert.doesNotMatch(
    collectionSummary([blocked, { ...run, source: "jobkorea" }]),
    /수집 대상으로 선택되지 않아/,
  );
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
      "wanted,wanted",
      "--max-pages",
      "3",
      "--max-details",
      "0",
    ]),
    { sources: ["wanted"], maxPages: 3, maxDetails: undefined },
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

test("Wanted discovery supplies public company metadata for diverse selection", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: [
        {
          id: 1,
          position: "백엔드 개발자",
          company: { id: 42, name: "Example" },
        },
      ],
      links: { next: null },
    }),
  );
  const candidates: unknown[] = [];
  await discoverWanted(1, Infinity, (job) => candidates.push(job));
  assert.deepEqual(candidates, [
    { id: "1", title: "백엔드 개발자", companyId: "42" },
  ]);
});
