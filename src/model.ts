import { z } from "zod";
export const sourceSchema = z.enum(["wanted", "jobkorea"]);
export type Source = z.infer<typeof sourceSchema>;
export const jobSchema = z.object({
  key: z.string(),
  source: sourceSchema,
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  title: z.string(),
  url: z.url(),
  location: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  minYears: z.number().nullable(),
  maxYears: z.number().nullable(),
  deadline: z.string().nullable(),
  status: z.enum(["open", "closed", "unknown"]),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  contentUpdatedAt: z.string(),
  hash: z.string(),
});
export type Job = z.infer<typeof jobSchema>;
export type Run = {
  at: string;
  success: boolean;
  complete: boolean;
  discovered: number;
  fetched: number;
  failed: number;
  filtered?: number;
  reason: string | null;
};
export type Dataset = {
  jobs: Job[];
  run: Run | null;
  checkedAtById?: Record<string, string>;
};
const companyFlags = z.object({
  isSkipped: z.boolean().default(false),
  isInterested: z.boolean().default(false),
});
const safeKey = z
  .string()
  .min(1)
  .refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
export const stateSchema = z.object({
  version: z.literal(1),
  companies: z.record(safeKey, companyFlags),
  jobs: z.record(safeKey, z.object({ isApplied: z.boolean() })),
  links: z.record(safeKey, safeKey),
  commutes: z.record(
    safeKey,
    z.object({
      minutes: z.number().nonnegative().max(1440),
      checkedAt: z.iso.datetime(),
    }),
  ),
  origins: z.array(z.string().max(80)).max(2),
  lastReviewedAt: z.iso.datetime().nullable(),
});
export type State = z.infer<typeof stateSchema>;
export const emptyState = (): State => ({
  version: 1,
  companies: {},
  jobs: {},
  links: {},
  commutes: {},
  origins: [],
  lastReviewedAt: null,
});
