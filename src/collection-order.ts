import type { Dataset } from "./model.js";
import { titlePosition } from "./matching.js";

export type Candidate = { id: string; title: string; companyId?: string };

function roundRobin<T>(queues: T[][]): T[] {
  const result: T[] = [];
  while (queues.length) {
    for (let i = 0; i < queues.length;) {
      result.push(queues[i].shift()!);
      if (!queues[i].length) queues.splice(i, 1);
      else i++;
    }
  }
  return result;
}

export function diverseCandidates(
  candidates: Candidate[],
  old: Dataset,
): string[] {
  const previous = new Map(old.jobs.map((job) => [job.id, job]));
  const checked = (id: string) =>
    old.checkedAtById?.[id] ?? previous.get(id)?.lastSeenAt ?? "";
  const sorted = [
    ...new Map(candidates.map((job) => [job.id, job])).values(),
  ].sort((a, b) => checked(a.id).localeCompare(checked(b.id)));
  // Unvisited candidates precede refreshes. Within each pool, alternate roles
  // and then companies so a large employer cannot consume the entire budget.
  return [
    sorted.filter((job) => !checked(job.id)),
    sorted.filter((job) => checked(job.id)),
  ].flatMap((pool) => {
    const lanes = new Map<string, Map<string, Candidate[]>>();
    for (const candidate of pool) {
      const role = titlePosition(candidate.title) ?? "general";
      const companies = lanes.get(role) ?? new Map<string, Candidate[]>();
      const company =
        candidate.companyId ||
        previous.get(candidate.id)?.companyId ||
        `job:${candidate.id}`;
      companies.set(company, [...(companies.get(company) ?? []), candidate]);
      lanes.set(role, companies);
    }
    return roundRobin(
      [...lanes.values()].map((companies) =>
        roundRobin([...companies.values()]),
      ),
    ).map((job) => job.id);
  });
}
