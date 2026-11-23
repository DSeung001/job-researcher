import { createHash } from "node:crypto";
import type { Job, State } from "./model.js";
import profile from "../config/profile.public.json";
import { classifyJob, titlePosition } from "./matching.js";
export function contentHash(job: Partial<Job>) {
  const { firstSeenAt, lastSeenAt, contentUpdatedAt, hash, ...content } = job;
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...content,
        skills: [...(content.skills ?? [])].sort(),
      }),
    )
    .digest("hex");
}
export function mergeJobs(existing: Job[], incoming: Job[], now: string) {
  const map = new Map(existing.map((j) => [j.key, j]));
  for (const job of incoming) {
    const old = map.get(job.key);
    const hash = contentHash(job);
    map.set(job.key, {
      ...job,
      hash,
      firstSeenAt: old?.firstSeenAt ?? now,
      lastSeenAt: now,
      contentUpdatedAt: old?.hash === hash ? old.contentUpdatedAt : now,
    });
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export const companyKey = (j: Job) => `${j.source}:${j.companyId}`;
export function linkedKey(key: string, state: State): string {
  return state.links[key] ?? key;
}
export function scoreJob(job: Job, state: State) {
  const text = (job.title + " " + job.description).toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const position = classifyJob(job);
  if (position) {
    score += 40;
    reasons.push(
      titlePosition(job.title)
        ? position === "backend"
          ? "백엔드 직무"
          : "풀스택 직무"
        : "본문에 백엔드 업무 근거",
    );
  }
  const skills = profile.skills.filter((s) =>
    new RegExp(`(^|[^a-z0-9])${s.toLowerCase()}([^a-z0-9]|$)`, "i").test(text),
  );
  score += Math.min(30, skills.length * 6);
  if (skills.length) reasons.push(`기술: ${skills.join(", ")}`);
  const years = profile.experienceYears;
  // Wanted encodes "no upper bound" as 100.
  const maxYears =
    job.maxYears !== null && job.maxYears < 100 ? job.maxYears : null;
  const juniorTitle =
    job.minYears === null &&
    maxYears === null &&
    /신입|인턴|주니어|junior|intern/i.test(job.title);
  if ((maxYears !== null && maxYears < years) || juniorTitle) {
    score -= 15;
    reasons.push("주니어 대상 공고");
  } else if (job.minYears !== null && job.minYears >= years + 2) {
    score -= 15;
    reasons.push(`요구 경력 ${job.minYears}년 이상`);
  } else if (job.minYears !== null && job.minYears > years)
    reasons.push(`요구 경력 ${job.minYears}년 (확인)`);
  else if (job.minYears !== null) {
    score += 15;
    reasons.push("경력 범위 적합");
  }
  const domains = profile.domains.filter((d) => text.includes(d.toLowerCase()));
  if (domains.length) {
    score += 8;
    reasons.push(`선호 도메인: ${domains.slice(0, 3).join(", ")}`);
  }
  if (profile.trafficSignals.some((t) => text.includes(t))) {
    score += 5;
    reasons.push("트래픽·규모 관련 근거");
  }
  const commute = state.commutes[linkedKey(companyKey(job), state)];
  if (commute && commute.minutes <= 40) {
    score += 2;
    reasons.push("통근 40분 이내");
  }
  return {
    score: Math.max(0, score),
    reasons,
    isNew: !state.lastReviewedAt || job.firstSeenAt > state.lastReviewedAt,
    isUpdated:
      !!state.lastReviewedAt &&
      job.firstSeenAt <= state.lastReviewedAt &&
      job.contentUpdatedAt > state.lastReviewedAt,
  };
}
