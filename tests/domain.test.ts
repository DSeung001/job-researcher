import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, type Job } from "../src/model.js";
import { mergeJobs, scoreJob } from "../src/domain.js";
import {
  parseJobkorea,
  parseWanted,
  publicText,
  relevant,
  deadlineTime,
} from "../src/collectors.js";
import { inspectPublicFile } from "../src/privacy.js";
const sample: Job = {
  key: "wanted:1",
  source: "wanted",
  id: "1",
  companyId: "9",
  companyName: "Example",
  title: "백엔드 개발자",
  url: "https://www.wanted.co.kr/wd/1",
  location: "서울",
  description: "Python Django Redis 커머스 대규모 트래픽",
  skills: ["Redis", "Python"],
  minYears: 3,
  maxYears: 8,
  deadline: null,
  status: "open",
  firstSeenAt: "",
  lastSeenAt: "",
  contentUpdatedAt: "",
  hash: "",
};
test("rescans preserve first seen and update only meaningful content", () => {
  const first = mergeJobs([], [sample], "2026-01-01T00:00:00Z");
  const second = mergeJobs(
    first,
    [{ ...sample, skills: ["Python", "Redis"] }],
    "2026-01-02T00:00:00Z",
  );
  assert.equal(second.length, 1);
  assert.equal(second[0].contentUpdatedAt, first[0].contentUpdatedAt);
  assert.equal(second[0].firstSeenAt, first[0].firstSeenAt);
  assert.equal(second[0].lastSeenAt, "2026-01-02T00:00:00Z");
  const changed = mergeJobs(
    second,
    [{ ...sample, title: "플랫폼 개발자" }],
    "2026-01-03T00:00:00Z",
  );
  assert.equal(changed[0].contentUpdatedAt, "2026-01-03T00:00:00Z");
  assert.equal(
    mergeJobs(changed, [], "2026-01-04T00:00:00Z")[0].status,
    "open",
  );
});
test("new and updated derive from review watermark; domains never exclude", () => {
  const [job] = mergeJobs([], [sample], "2026-01-01T00:00:00Z");
  const state = emptyState();
  assert.equal(scoreJob(job, state).isNew, true);
  state.lastReviewedAt = "2026-01-02T00:00:00Z";
  assert.equal(scoreJob(job, state).isNew, false);
  assert.equal(
    scoreJob({ ...job, contentUpdatedAt: "2026-01-03T00:00:00Z" }, state)
      .isUpdated,
    true,
  );
  assert.ok(
    scoreJob({ ...job, description: "Python Django 금융" }, state).score > 0,
  );
});
test("Wanted detail extracts closed status and organization identity", () => {
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { initialData: { id: 1, company: { company_id: 9, company_name: "Example" }, position: "백엔드", address: { full_location: "서울" }, status: "close", career: { annual_from: 3, annual_to: 8 }, requirements: "Python" } } } })}</script>`;
  const job = parseWanted(html, "1");
  assert.equal(job.status, "closed");
  assert.equal(job.companyId, "9");
  assert.equal(job.minYears, 3);
  assert.throws(() => parseWanted(html, "2"));
});
test("Jobkorea parses structured metadata and does not invent an open state", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Backend", hiringOrganization: { name: "Example" }, description: "Python", jobLocation: { address: { streetAddress: "Seoul" } }, experienceRequirements: "3년 ~ 8년" })}</script>`;
  const { job } = parseJobkorea(html, "1");
  assert.equal(job.status, "unknown");
  assert.equal(job.minYears, 3);
  assert.equal(job.maxYears, 8);
  assert.equal(job.location, "Seoul");
});
test("public artifacts reject private state and unapproved files", () => {
  assert.ok(inspectPublicFile("data/wanted.json", '{"origins":[]}').length);
  assert.ok(inspectPublicFile(".local/state.json", "{}").length);
  assert.deepEqual(inspectPublicFile("data/wanted.json", '{"jobs":[]}'), []);
});
test("training advertisements are excluded and public text removes contact details", () => {
  assert.equal(relevant("국비 전액지원 풀스택 교육생 모집"), false);
  assert.equal(relevant("플랫폼운영본부 기획담당자"), false);
  assert.equal(relevant("Python 백엔드 개발자"), true);
  assert.equal(
    publicText("문의 example@example.org 010-1234-5678"),
    "문의 [이메일 생략] [연락처 생략]",
  );
});
test("source deadlines are interpreted in Korea on any runner timezone", () => {
  assert.equal(
    deadlineTime("2026-12-01T23:59"),
    Date.parse("2026-12-01T14:59:00Z"),
  );
  assert.equal(deadlineTime("2026-12-01"), Date.parse("2026-12-01T14:59:59Z"));
});
