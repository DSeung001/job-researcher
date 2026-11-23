import { test } from "node:test";
import assert from "node:assert/strict";
import { diverseCandidates } from "../src/collection-order.js";
import type { Dataset } from "../src/model.js";

const empty: Dataset = { jobs: [], run: null };
test("a company with many listings cannot crowd other companies and roles out", () => {
  const ids = diverseCandidates(
    [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `large-${i}`,
        companyId: "large",
        title: "백엔드 개발자",
      })),
      { id: "small", companyId: "small", title: "백엔드 개발자" },
      { id: "fullstack", companyId: "fullstack", title: "풀스택 개발자" },
      { id: "generic", companyId: "generic", title: "Software Engineer" },
    ],
    empty,
  );
  assert.deepEqual(
    new Set(ids.slice(0, 4)),
    new Set(["large-0", "small", "fullstack", "generic"]),
  );
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
});

test("partial collection advances to unvisited and older jobs on subsequent runs", () => {
  const candidates = [
    { id: "recent", companyId: "a", title: "백엔드 개발자" },
    { id: "older", companyId: "a", title: "백엔드 개발자" },
    { id: "unvisited", companyId: "a", title: "백엔드 개발자" },
  ];
  assert.deepEqual(
    diverseCandidates(candidates, {
      ...empty,
      checkedAtById: { recent: "2026-11-23", older: "2026-11-20" },
    }),
    ["unvisited", "older", "recent"],
  );
});

test("deduplication preserves every candidate when company metadata is missing", () => {
  assert.deepEqual(
    diverseCandidates(
      [
        { id: "1", title: "백엔드 개발자" },
        { id: "1", title: "백엔드 개발자" },
        { id: "2", title: "백엔드 개발자" },
      ],
      empty,
    ),
    ["1", "2"],
  );
});

test("refreshing a minority role does not displace never-checked jobs", () => {
  assert.deepEqual(
    diverseCandidates(
      [
        { id: "refresh", title: "풀스택 개발자", companyId: "a" },
        { id: "new-1", title: "백엔드 개발자", companyId: "b" },
        { id: "new-2", title: "백엔드 개발자", companyId: "c" },
      ],
      { ...empty, checkedAtById: { refresh: "2026-11-23" } },
    ),
    ["new-1", "new-2", "refresh"],
  );
});
