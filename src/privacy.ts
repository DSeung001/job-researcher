import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const allowed = [
  "src/",
  "web/",
  "tests/",
  "config/",
  "data/",
  "reports/",
  ".github/",
  "docs/",
];
const rootFiles = new Set([
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "README.md",
  "AGENTS.md",
]);
const excluded = new Set([".git", ".local", "node_modules", "dist"]);
async function walk(dir = ""): Promise<string[]> {
  const entries = await readdir(dir || ".", { withFileTypes: true });
  const result: string[] = [];
  for (const e of entries) {
    if (excluded.has(e.name)) continue;
    const name = path.posix.join(dir, e.name);
    if (e.isDirectory()) result.push(...(await walk(name)));
    else result.push(name);
  }
  return result;
}
export function inspectPublicFile(file: string, text: string) {
  const errors: string[] = [];
  if (!(rootFiles.has(file) || allowed.some((p) => file.startsWith(p))))
    errors.push("unapproved path");
  if (/(^|\/)\.local\/|(^|\/)\.env(?:\.|$)/.test(file))
    errors.push("private file");
  if (
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(
      text,
    )
  )
    errors.push("credential pattern");
  if (/\b\d{6}-[1-8]\d{6}\b/.test(text)) errors.push("identity number pattern");
  if (/C:[\\/]personal-assistant[\\/]10 /i.test(text))
    errors.push("private source path");
  if (file.startsWith("data/") || file.startsWith("reports/")) {
    if (
      /"(?:origins|lastReviewedAt|isSkipped|isInterested|isApplied|commutes)"\s*:/.test(
        text,
      )
    )
      errors.push("private state in public data");
    if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text))
      errors.push("email in collected data");
  }
  return errors;
}
async function main() {
  let privateTerms: string[] = [];
  try {
    privateTerms =
      JSON.parse(await readFile(".local/state.json", "utf8")).origins ?? [];
  } catch {}
  let files = await walk();
  try {
    files = [
      ...new Set([
        ...files,
        ...execFileSync("git", ["ls-files", "-z"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
          .split("\0")
          .filter(Boolean),
      ]),
    ];
  } catch {}
  const failures = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const reason of inspectPublicFile(file, text))
      failures.push(`${file}: ${reason}`);
    if (privateTerms.some((term) => term && text.includes(term)))
      failures.push(`${file}: private origin value`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log(`Privacy check passed (${files.length} public files).`);
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/privacy.ts")) void main();
