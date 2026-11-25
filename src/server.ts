import express from "express";
import { createServer as createViteServer } from "vite";
import { z } from "zod";
import { readDataset, readState, mutateState } from "./store.js";
import { stateSchema } from "./model.js";
import { collect } from "./collect.js";
import { companyKey, linkedKey, scoreJob } from "./domain.js";
import { classifyJob } from "./matching.js";
const app = express();
app.use((req, res, next) => {
  const host = req.headers.host ?? "";
  if (!/^127\.0\.0\.1:\d+$/.test(host)) {
    res.status(403).json({ error: "허용되지 않은 호스트입니다." });
    return;
  }
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    req.headers.origin !== `http://${host}`
  ) {
    res.status(403).json({ error: "다른 출처의 요청은 허용하지 않습니다." });
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));
let collecting = false;
app.get("/api/dashboard", async (_req, res) => {
  const datasets = await Promise.all(["jobkorea"].map(readDataset));
  const state = await readState();
  const jobs = datasets
    .flatMap((d) => d.jobs)
    .filter((j) => classifyJob(j) !== null)
    .map((j) => ({
      ...j,
      ...scoreJob(j, state),
      companyKey: linkedKey(companyKey(j), state),
      originalCompanyKey: companyKey(j),
      isApplied: state.jobs[j.key]?.isApplied ?? false,
    }));
  res.json({
    jobs,
    state,
    runs: datasets.map((d, i) => ({
      source: ["jobkorea"][i],
      ...d.run,
    })),
    collecting,
  });
});
app.patch("/api/company", async (req, res) => {
  const input = z
    .object({
      key: z.string().min(1),
      isSkipped: z.boolean().optional(),
      isInterested: z.boolean().optional(),
    })
    .parse(req.body);
  await mutateState((s) => {
    const key = linkedKey(input.key, s);
    s.companies[key] = {
      isSkipped: s.companies[key]?.isSkipped ?? false,
      isInterested: s.companies[key]?.isInterested ?? false,
      ...(input.isSkipped !== undefined ? { isSkipped: input.isSkipped } : {}),
      ...(input.isInterested !== undefined
        ? { isInterested: input.isInterested }
        : {}),
    };
    return s;
  });
  res.json({ ok: true });
});
app.patch("/api/job", async (req, res) => {
  const input = z
    .object({ key: z.string(), isApplied: z.boolean() })
    .parse(req.body);
  await mutateState((s) => {
    s.jobs[input.key] = { isApplied: input.isApplied };
    return s;
  });
  res.json({ ok: true });
});
app.post("/api/review", async (_req, res) => {
  await mutateState((s) => ({
    ...s,
    lastReviewedAt: new Date().toISOString(),
  }));
  res.json({ ok: true });
});
app.post("/api/settings", async (req, res) => {
  const { origins } = z
    .object({ origins: z.array(z.string().trim().min(1).max(80)).max(2) })
    .parse(req.body);
  await mutateState((s) => ({ ...s, origins }));
  res.json({ ok: true });
});
app.post("/api/commute", async (req, res) => {
  const { key, minutes } = z
    .object({ key: z.string(), minutes: z.number().nonnegative().max(1440) })
    .parse(req.body);
  await mutateState((s) => {
    s.commutes[linkedKey(key, s)] = {
      minutes,
      checkedAt: new Date().toISOString(),
    };
    return s;
  });
  res.json({ ok: true });
});
app.post("/api/link", async (req, res) => {
  const { from, to } = z
    .object({ from: z.string().min(1), to: z.string().min(1) })
    .parse(req.body);
  await mutateState((s) => {
    const target = linkedKey(to, s);
    const origin = linkedKey(from, s);
    if (origin === target) return s;
    for (const [key, value] of Object.entries(s.links))
      if (value === origin) s.links[key] = target;
    s.links[origin] = target;
    s.links[from] = target;
    const a = s.companies[origin],
      b = s.companies[target];
    s.companies[target] = {
      isSkipped: !!(a?.isSkipped || b?.isSkipped),
      isInterested: !!(a?.isInterested || b?.isInterested),
    };
    if (s.commutes[origin] && !s.commutes[target])
      s.commutes[target] = s.commutes[origin];
    return s;
  });
  res.json({ ok: true });
});
app.get("/api/backup", async (_req, res) =>
  res.attachment("job-researcher-private-backup.json").json(await readState()),
);
app.post("/api/restore", async (req, res) => {
  const restored = stateSchema.parse(req.body);
  await mutateState(() => restored);
  res.json({ ok: true });
});
app.post("/api/collect", (_req, res) => {
  if (collecting) {
    res.status(409).json({ error: "이미 수집 중입니다." });
    return;
  }
  collecting = true;
  void collect()
    .catch(() => console.error("Collection failed"))
    .finally(() => {
      collecting = false;
    });
  res.status(202).json({ ok: true });
});
app.post("/api/sync", async (_req, res) => {
  if (collecting) {
    res.status(409).json({ error: "수집이 끝난 뒤 갱신해 주세요." });
    return;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("git", ["pull", "--ff-only"], { timeout: 30000 });
  res.json({ ok: true });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "알 수 없는 요청입니다." }),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error instanceof z.ZodError ? 400 : 500).json({
      error:
        error instanceof z.ZodError
          ? "입력 형식을 확인해 주세요."
          : "처리하지 못했습니다. 로컬 파일 상태 또는 네트워크를 확인해 주세요.",
    });
  },
);
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);
app.listen(4317, "127.0.0.1", () =>
  console.log("Local: http://127.0.0.1:4317"),
);
