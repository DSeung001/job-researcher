import { mkdir, open, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { atomicJson, readDataset } from "./store.js";
import { mergeJobs } from "./domain.js";
import {
  discoverWanted,
  discoverJobkorea,
  getDetail,
  sleep,
} from "./collectors.js";
import type { Job, Source } from "./model.js";
export async function collect(
  options: { maxPages?: number; maxDetails?: number } = {},
) {
  await mkdir(".local", { recursive: true });
  const lock = await open(".local/collect.lock", "wx").catch(() => {
    throw new Error(
      "Collection already running; remove stale .local/collect.lock only if no collector is running",
    );
  });
  const results = [];
  try {
    for (const source of ["jobkorea", "wanted"] as Source[]) {
      const old = await readDataset(source);
      const now = new Date().toISOString();
      let discovered = 0,
        failed = 0;
      const jobs: Job[] = [];
      let complete = false;
      let reason: string | null = null;
      try {
        const discovery = await (
          source === "wanted" ? discoverWanted : discoverJobkorea
        )(options.maxPages ?? 250);
        discovered = discovery.ids.length;
        complete = discovery.complete;
        reason = discovery.reason;
        const candidates = [
          ...new Set([
            ...discovery.ids,
            ...old.jobs.filter((j) => j.status !== "closed").map((j) => j.id),
          ]),
        ];
        const targets = candidates.slice(0, options.maxDetails ?? Infinity);
        if (targets.length < candidates.length) {
          complete = false;
          reason = "detail-limit";
        }
        for (const id of targets) {
          try {
            jobs.push(await getDetail(source, id));
          } catch {
            failed++;
          }
          await sleep(600);
        }
        if (failed) {
          complete = false;
          reason = "detail-failures";
        }
      } catch (e) {
        const status =
          e instanceof Error ? e.message.match(/HTTP (\d{3})/)?.[1] : null;
        reason = status ? `listing-http-${status}` : "listing-failed";
        complete = false;
      }
      const run = {
        at: now,
        success: complete && failed === 0,
        complete,
        discovered,
        fetched: jobs.length,
        failed,
        reason,
      };
      await atomicJson(`data/${source}.json`, {
        jobs: mergeJobs(old.jobs, jobs, now),
        run,
      });
      results.push({ source, ...run });
      console.log(
        `${source}: ${jobs.length}/${discovered}, complete=${complete}, ${reason ?? "ok"}`,
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
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) || undefined : undefined;
  };
  collect({ maxPages: arg("--max-pages"), maxDetails: arg("--max-details") })
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
