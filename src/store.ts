import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyState, stateSchema, type State, type Dataset } from "./model.js";
export const root = process.cwd();
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export async function atomicJson(file: string, value: unknown) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = target + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, target);
}
export const readState = async () =>
  stateSchema.parse(await readJson<State>(".local/state.json", emptyState()));
export const writeState = (state: State) =>
  atomicJson(".local/state.json", stateSchema.parse(state));
export const readDataset = (source: string) =>
  readJson<Dataset>(`data/${source}.json`, { jobs: [], run: null });
let queue = Promise.resolve();
export function mutateState(fn: (s: State) => State | Promise<State>) {
  const result = queue.then(async () => {
    const next = await fn(await readState());
    await writeState(next);
    return next;
  });
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
