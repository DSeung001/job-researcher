import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, type Job } from "../src/model.js";
import { mergeJobs, scoreJob } from "../src/domain.js";
import {
  parseJobkorea,
  publicText,
  relevant,
  deadlineTime,
  parseYears,
} from "../src/collectors.js";
import { inspectPublicFile } from "../src/privacy.js";
const sample: Job = {
  key: "jobkorea:1",
  source: "jobkorea",
  id: "1",
  companyId: "9",
  companyName: "Example",
  title: "백엔드 개발자",
  url: "https://www.jobkorea.co.kr/Recruit/GI_Read/1",
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
test("Jobkorea parses structured metadata and does not invent an open state", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Backend", hiringOrganization: { name: "Example" }, description: "Python", jobLocation: { address: { streetAddress: "Seoul" } }, experienceRequirements: "3년 ~ 8년" })}</script>`;
  const { job } = parseJobkorea(html, "1");
  assert.equal(job.status, "unknown");
  assert.equal(job.minYears, 3);
  assert.equal(job.maxYears, 8);
  assert.equal(job.location, "Seoul");
});
test("public artifacts reject private state and unapproved files", () => {
  assert.ok(inspectPublicFile("data/jobkorea.json", '{"origins":[]}').length);
  assert.ok(inspectPublicFile(".local/state.json", "{}").length);
  assert.deepEqual(inspectPublicFile("data/jobkorea.json", '{"jobs":[]}'), []);
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
test("Jobkorea reads years from the meta summary when JSON-LD says only 경력", () => {
  const ld = (exp: string) =>
    `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Backend", hiringOrganization: { name: "Example" }, description: "백엔드 개발 경력 3년 이상", experienceRequirements: exp })}</script>`;
  const meta = `<meta name="description" content="경력 : 경력 5년이상, 학력 : 초대졸↑, 마감일 : 2026.12.07"/>`;
  const fromMeta = parseJobkorea(meta + ld("경력"), "1").job;
  assert.equal(fromMeta.minYears, 5);
  assert.equal(fromMeta.maxYears, null);
  assert.equal(parseJobkorea(ld("경력"), "1").job.minYears, 3);
  assert.deepEqual(parseYears("경력 3~10년"), { min: 3, max: 10, known: true });
  assert.deepEqual(parseYears("신입"), { min: 0, max: 0, known: true });
  assert.deepEqual(parseYears("경력무관"), { min: null, max: null, known: true });
  assert.deepEqual(parseYears("신입·경력"), { min: null, max: null, known: true });
  assert.equal(parseYears("경력").known, false);
});
test("experience outside 6 years is penalized; 7 years is allowed", () => {
  const state = emptyState();
  const score = (patch: Partial<Job>) => scoreJob({ ...sample, ...patch }, state);
  const fit = score({ minYears: 5, maxYears: null });
  assert.ok(fit.reasons.includes("경력 범위 적합"));
  const junior = score({ minYears: 1, maxYears: 3 });
  assert.equal(junior.score, fit.score - 30);
  assert.ok(junior.reasons.includes("주니어 대상 공고"));
  assert.ok(
    score({ title: "주니어 백엔드", minYears: null, maxYears: null }).reasons.includes("주니어 대상 공고"),
  );
  assert.equal(score({ minYears: 7, maxYears: null }).score, fit.score - 15);
  assert.equal(score({ minYears: 8, maxYears: null }).score, fit.score - 30);
  assert.ok(score({ title: "x", description: "", minYears: 10, maxYears: null }).score >= 0);
});
