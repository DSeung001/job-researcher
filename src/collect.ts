import { mkdir, open, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { atomicJson, readDataset } from "./store.js";
import { mergeJobs } from "./domain.js";
import {
  discoverWanted,
  discoverJobkorea,
  getDetail,
  sleep,
  listingFailure,
} from "./collectors.js";
import type { Job } from "./model.js";
import { diverseCandidates, type Candidate } from "./collection-order.js";
import { classifyJob } from "./matching.js";
import { limitReason } from "./collection-status.js";
import {
  parseCollectionOptions,
  type CollectionOptions,
} from "./collection-options.js";
export async function collect(options: CollectionOptions = {}) {
  await mkdir(".local", { recursive: true });
  const lock = await open(".local/collect.lock", "wx").catch(() => {
    throw new Error(
      "Collection already running; remove stale .local/collect.lock only if no collector is running",
    );
  });
  const results = [];
  try {
    for (const source of options.sources ?? ["jobkorea", "wanted"]) {
      const old = await readDataset(source);
      const checkedAtById = { ...old.checkedAtById };
      const deadline = Date.now() + 22 * 60 * 1000;
      const now = new Date().toISOString();
      let discovered = 0,
        failed = 0,
        filtered = 0;
      const jobs: Job[] = [];
      let complete = false;
      let reason: string | null = null;
      try {
        const metadata = new Map<string, Candidate>();
        const discovery = await (
          source === "wanted" ? discoverWanted : discoverJobkorea
        )(options.maxPages ?? 250, deadline, (candidate) =>
          metadata.set(candidate.id, candidate),
        );
        discovered = discovery.ids.length;
        complete = discovery.complete;
        reason = discovery.reason;
        const candidates = diverseCandidates(
          [
            ...old.jobs
              .filter(
                (job) => job.status !== "closed" && classifyJob(job) !== null,
              )
              .map((job) => ({
                id: job.id,
                title: job.title,
                companyId: job.companyId,
              })),
            ...discovery.ids.map((id) => metadata.get(id) ?? { id, title: "" }),
          ],
          old,
        );
        const targets = candidates.slice(0, options.maxDetails ?? Infinity);
        if (targets.length < candidates.length) {
          complete = false;
          reason = limitReason(reason, "detail-limit");
        }
        for (const id of targets) {
          if (Date.now() >= deadline) {
            complete = false;
            reason = limitReason(reason, "time-budget");
            break;
          }
          try {
            const job = await getDetail(source, id);
            if (classifyJob(job) !== null) jobs.push(job);
            else filtered++;
          } catch {
            failed++;
          }
          checkedAtById[id] = now;
          if ((jobs.length + failed + filtered) % 25 === 0) {
            console.log(
              `${source}: checked=${jobs.length + failed + filtered}/${targets.length}, saved=${jobs.length}, filtered=${filtered}, failed=${failed}`,
            );
            await atomicJson(`data/${source}.json`, {
              jobs: mergeJobs(old.jobs, jobs, now),
              checkedAtById,
              run: {
                at: now,
                success: false,
                complete: false,
                discovered,
                fetched: jobs.length,
                failed,
                filtered,
                reason: "in-progress",
              },
            });
          }
          await sleep(600);
        }
        if (failed) {
          complete = false;
          reason = "detail-failures";
        }
      } catch (e) {
        reason = listingFailure(e);
        complete = false;
      }
      const run = {
        at: now,
        success: complete && failed === 0,
        complete,
        discovered,
        fetched: jobs.length,
        failed,
        filtered,
        reason,
      };
      await atomicJson(`data/${source}.json`, {
        jobs: mergeJobs(old.jobs, jobs, now),
        checkedAtById,
        run,
      });
      results.push({ source, ...run });
      console.log(
        `${source}: discovered=${discovered}, fetched=${jobs.length}, filtered=${filtered}, failed=${failed}, complete=${complete}, ${reason ?? "ok"}`,
      );
    }
    await atomicJson("reports/collection.json", results);
    return results;
  } finally {
    await lock.close();
    await unlink(".local/collect.lock");
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Promise.resolve()
    .then(() => collect(parseCollectionOptions(process.argv.slice(2))))
    .then((r) => {
      if (r.some((x) => !x.success)) process.exitCode = 1;
    })
    .catch(() => {
      console.error(
        "Collection failed; inspect local environment and existing lock.",
      );
      process.exitCode = 1;
    });
}
