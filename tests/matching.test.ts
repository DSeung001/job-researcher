import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyJob, isCandidateTitle } from "../src/matching.js";
import { scoreJob } from "../src/domain.js";
import { emptyState, type Job } from "../src/model.js";

test("backend and fullstack title variants are primary targets regardless of domain", () => {
  for (const title of [
    "백엔드 개발자",
    "백앤드 개발자",
    "Backend Engineer",
    "Back-end Developer",
    "서버 개발자",
    "AI 엔지니어 BE",
  ])
    assert.equal(classifyJob({ title, description: "금융 서비스" }), "backend");
  for (const title of [
    "풀스택 개발자",
    "풀스텍 개발자",
    "Full-stack Engineer",
    "Full Stack Developer",
  ])
    assert.equal(
      classifyJob({ title, description: "산업용 웹 서비스" }),
      "fullstack",
    );
});

test("independent adjacent roles do not become backend recommendations from incidental keywords", () => {
  for (const title of [
    "DevOps Engineer",
    "플랫폼 인프라 엔지니어",
    "프론트엔드 개발자",
    "데이터 엔지니어",
    "검색 마케팅 기획자",
    "백엔드 QA 엔지니어",
    "풀스택 강사",
  ])
    assert.equal(
      classifyJob({
        title,
        description: "Python Django REST API 백엔드 팀과 협업",
      }),
      null,
      title,
    );
});

test("generic software titles require both backend work and technical evidence", () => {
  assert.equal(
    classifyJob({
      title: "웹 개발자",
      description: "API 설계 및 개발, Java Spring MySQL 운영",
    }),
    "backend",
  );
  assert.equal(
    classifyJob({
      title: "소프트웨어 엔지니어",
      description: "Python REST API 개발, 풀스택 웹 서비스",
    }),
    "fullstack",
  );
  assert.equal(
    classifyJob({
      title: "웹 개발자",
      description: "Vue UI 디자인 및 퍼블리싱",
    }),
    null,
  );
  assert.equal(
    classifyJob({
      title: "소프트웨어 엔지니어",
      description: "서버 개발 조직과 회의",
    }),
    null,
  );
  assert.equal(isCandidateTitle("플랫폼 운영 기획자"), false);
});

test("resume-backed Java Spring and Vue skills participate in ranking without copying personal history", () => {
  const job = {
    title: "풀스택 개발자",
    description: "Java Spring Vue MySQL",
    minYears: 3,
    maxYears: 8,
    firstSeenAt: "2026-01-01T00:00:00Z",
    contentUpdatedAt: "2026-01-01T00:00:00Z",
    source: "wanted",
    companyId: "example",
  } as Job;
  const ranked = scoreJob(job, emptyState());
  assert.ok(
    ranked.reasons.some(
      (r) => r.includes("Java") && r.includes("Spring") && r.includes("Vue"),
    ),
  );
  assert.ok(ranked.reasons.includes("경력 범위 적합"));
});
