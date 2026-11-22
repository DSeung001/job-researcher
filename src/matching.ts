import type { Job } from "./model.js";

export type Position = "backend" | "fullstack";
const excludedTitles =
  /국비|교육생|취업교육|기획담당|기획자|퍼블리셔|프론트엔드|프런트엔드|front[- ]?end|devops|데브옵스|\bsre\b|\bqa\b|인프라|보안|네트워크|임베디드|펌웨어|하드웨어|데이터\s*(엔지니어|분석)|data\s*(engineer|scientist)|머신러닝|머신 러닝|\bml\b|안드로이드|android|\bios\b/i;
const hardExcludedTitles =
  /국비|교육생|취업교육|강사|기술영업|\bqa\b|테스터|테스트\s*엔지니어/i;

export function titlePosition(title: string): Position | null {
  const normalized = title.toLowerCase().replace(/[\s._-]+/g, "");
  if (/풀스[택텍]|fullstack/.test(normalized)) return "fullstack";
  if (
    /백[엔앤]드|backend/.test(normalized) ||
    /서버\s*개발|server\s*developer|\bbe\b/i.test(title)
  )
    return "backend";
  return null;
}

export function isCandidateTitle(title: string): boolean {
  if (hardExcludedTitles.test(title)) return false;
  return (
    titlePosition(title) !== null ||
    (!excludedTitles.test(title) && /개발|엔지니어|engineer|developer/i.test(title))
  );
}

export function classifyJob(
  job: Pick<Job, "title" | "description">,
): Position | null {
  if (!isCandidateTitle(job.title)) return null;
  const explicit = titlePosition(job.title);
  if (explicit) return explicit;
  // Generic web/software titles need backend evidence in the actual posting.
  const body = job.description;
  if (
    !/백[엔앤]드|back[- ]?end|서버\s*(개발|로직)|API\s*(설계|개발)|REST(?:ful)?\s*API|GraphQL/i.test(
      body,
    )
  )
    return null;
  if (
    !/Go(?:lang)?\b|Python|Django|PHP|Laravel|Java\b|Spring|Node\.?js|NestJS|데이터베이스|DB\s*설계|PostgreSQL|MySQL|Redis/i.test(
      body,
    )
  )
    return null;
  return /풀스[택텍]|full[- ]?stack/i.test(body) ? "fullstack" : "backend";
}
