import type { Run } from "./model.js";

export type CollectionStatus = "complete" | "partial" | "blocked" | "failed";
const limits = new Set([
  "page-limit",
  "detail-limit",
  "scroll-limit",
  "time-budget",
]);
export function limitReason(current: string | null, limit: string) {
  return current && !limits.has(current) ? current : limit;
}
export function collectionStatus(run: Run): CollectionStatus {
  if (run.success) return "complete";
  if (run.fetched > 0 || (run.filtered ?? 0) > 0) return "partial";
  if (run.reason === "listing-http-403") return "blocked";
  return limits.has(run.reason ?? "") ? "partial" : "failed";
}
export function collectionFailed(runs: Run[], allowLimits = false) {
  return runs.some(
    (run) => !run.success && !(allowLimits && limits.has(run.reason ?? "")),
  );
}
export const statusLabel = (run: Run) =>
  ({
    complete: "완료",
    partial: "일부 수집",
    blocked: "접근 차단",
    failed: "수집 실패",
  })[collectionStatus(run)];
