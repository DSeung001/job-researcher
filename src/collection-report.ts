import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { collectionFailed, statusLabel } from "./collection-status.js";
import { parseCollectionOptions } from "./collection-options.js";
import type { Run, Source } from "./model.js";

export function collectionSummary(runs: (Run & { source: Source })[]) {
  return [
    "## 공고 수집 결과",
    "",
    "| 사이트 | 상태 | 발견 | 저장 | 제외 | 상세 실패 | 사유 |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...runs.map(
      (run) =>
        `| 잡코리아 | ${statusLabel(run)} | ${run.discovered} | ${run.fetched} | ${run.filtered ?? 0} | ${run.failed} | ${run.reason ?? "정상"} |`,
    ),
    "",
    "일부 수집·차단 시 기존 공고를 보존합니다. 제한에 도달한 실행은 경고하고, 접근 차단·수집 오류는 실패로 표시합니다.",
    "",
  ].join("\n");
}
async function main() {
  const runs = JSON.parse(
    await readFile("reports/collection.json", "utf8"),
  ) as (Run & { source: Source })[];
  const sources = parseCollectionOptions(process.argv.slice(2)).sources ?? ["jobkorea"];
  if (
    runs.length !== sources.length ||
    new Set(runs.map((run) => run.source)).size !== sources.length ||
    sources.some((source) => !runs.some((run) => run.source === source))
  )
    throw new Error("Missing collection results");
  const summary = collectionSummary(runs);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  for (const run of runs) {
    if (!run.success && process.env.GITHUB_ACTIONS)
      console.log(
        `::${collectionFailed([run], true) ? "error" : "warning"}::${run.source}: ${run.reason}`,
      );
  }
  if (collectionFailed(runs, true)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
