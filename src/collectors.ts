import * as cheerio from "cheerio";
import { z } from "zod";
import type { Job, Source } from "./model.js";
import profile from "../config/profile.public.json";
import type { Candidate } from "./collection-order.js";
import { isCandidateTitle } from "./matching.js";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function fetchHtml(url: string, options: RequestInit = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(25000),
        headers: {
          "User-Agent": "JobResearcher/0.1 (personal job discovery)",
          ...options.headers,
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (
        attempt === 2 ||
        (e instanceof Error &&
          /HTTP 4\d\d/.test(e.message) &&
          !/HTTP 429/.test(e.message))
      )
        throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error("Request failed");
}
export const relevant = isCandidateTitle;
export function publicText(text: string) {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[이메일 생략]")
    .replace(
      /\b(?:01[016789]|0\d{1,2})[-. ]?\d{3,4}[-. ]?\d{4}\b/g,
      "[연락처 생략]",
    );
}
function base(source: Source, id: string): Job {
  return {
    key: `${source}:${id}`,
    source,
    id,
    companyId: id,
    companyName: "",
    title: "",
    url:
      source === "wanted"
        ? `https://www.wanted.co.kr/wd/${id}`
        : `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`,
    location: "",
    description: "",
    skills: [],
    minYears: null,
    maxYears: null,
    deadline: null,
    status: "unknown",
    firstSeenAt: "",
    lastSeenAt: "",
    contentUpdatedAt: "",
    hash: "",
  };
}
export function parseWanted(html: string, id: string): Job {
  const $ = cheerio.load(html);
  const data = JSON.parse($("#__NEXT_DATA__").text()).props.pageProps
    .initialData;
  return wantedJob(data, id);
}
function wantedJob(data: any, id: string): Job {
  if (
    !data ||
    String(data.id) !== id ||
    !data.company?.company_name ||
    !data.position
  )
    throw new Error("Missing Wanted detail");
  const j = base("wanted", id);
  j.companyId = String(data.company.company_id);
  j.companyName = data.company.company_name;
  j.title = data.position;
  j.location = data.address?.full_location ?? "";
  j.description = publicText(
    [
      data.company.company_description,
      data.intro,
      data.main_tasks,
      data.requirements,
      data.preferred_points,
      data.benefits,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  j.minYears = data.career?.annual_from ?? null;
  j.maxYears = data.career?.annual_to ?? null;
  j.deadline = data.due_time ?? null;
  j.status =
    data.status === "close"
      ? "closed"
      : ["open", "active"].includes(data.status)
        ? "open"
        : "unknown";
  j.skills = profile.skills.filter((s) =>
    j.description.toLowerCase().includes(s.toLowerCase()),
  );
  return j;
}
export function parseWantedApi(value: unknown, id: string): Job {
  const { job } = z
    .object({
      job: z.object({
        id: z.number(),
        position: z.string(),
        company: z.object({ id: z.number(), name: z.string() }),
        detail: z.object({
          intro: z.string().nullish(),
          main_tasks: z.string().nullish(),
          requirements: z.string().nullish(),
          preferred_points: z.string().nullish(),
          benefits: z.string().nullish(),
        }),
        address: z
          .object({
            full_location: z.string().nullish(),
            location: z.string().nullish(),
          })
          .nullish(),
        annual_from: z.number().nullish(),
        annual_to: z.number().nullish(),
        due_time: z.string().nullish(),
        status: z.string(),
      }),
    })
    .parse(value);
  return wantedJob(
    {
      ...job.detail,
      id: job.id,
      position: job.position,
      company: { company_id: job.company.id, company_name: job.company.name },
      address: {
        full_location: [job.address?.location, job.address?.full_location]
          .filter(Boolean)
          .join(" "),
      },
      career: { annual_from: job.annual_from, annual_to: job.annual_to },
      due_time: job.due_time,
      status: job.status,
    },
    id,
  );
}
export function listingFailure(error: unknown) {
  const status =
    error instanceof Error ? error.message.match(/HTTP (\d{3})/)?.[1] : null;
  return status ? `listing-http-${status}` : "listing-failed";
}
export function deadlineTime(value: string): number {
  return Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value + "T23:59:59+09:00"
      : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? value
        : value + "+09:00",
  );
}
export function parseJobkorea(
  html: string,
  id: string,
): { job: Job; iframe: string | null } {
  const $ = cheerio.load(html);
  let data: any;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text());
      const candidates = Array.isArray(parsed)
        ? parsed
        : (parsed["@graph"] ?? [parsed]);
      data = candidates.find((x: any) => x["@type"] === "JobPosting") ?? data;
    } catch {}
  }
  if (!data) throw new Error("Missing JobPosting");
  const j = base("jobkorea", id);
  if (data.identifier?.value && String(data.identifier.value) !== id)
    throw new Error("Mismatched JobPosting");
  j.title = data.title;
  j.companyName = data.hiringOrganization?.name ?? "";
  const companyHref = $('a[href*="/Recruit/Co_Read/"],a[href*="/company/"]')
    .first()
    .attr("href");
  j.companyId =
    companyHref?.split("?")[0].split("/").filter(Boolean).at(-1) ??
    `name-${j.companyName.normalize("NFKC").replace(/\s+/g, "")}`;
  const loc = Array.isArray(data.jobLocation)
    ? data.jobLocation[0]
    : data.jobLocation;
  j.location = loc?.address?.streetAddress ?? "";
  j.description = cheerio.load(data.description ?? "").text();
  const body = $(".artReadJobSum, .tbRow, .artReadRecruit, #devContent")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  j.description += "\n" + body;
  j.deadline = data.validThrough ?? null;
  j.status =
    j.deadline && !Number.isNaN(deadlineTime(j.deadline))
      ? deadlineTime(j.deadline) < Date.now()
        ? "closed"
        : "open"
      : "unknown";
  const years = String(data.experienceRequirements ?? "").match(
    /(\d+)\s*년(?:\s*[~～-]\s*(\d+)\s*년?)?/,
  );
  j.minYears = years ? Number(years[1]) : null;
  j.maxYears = years?.[2] ? Number(years[2]) : null;
  j.skills = profile.skills.filter((s) =>
    j.description.toLowerCase().includes(s.toLowerCase()),
  );
  const embeddedFrame = html
    .match(/\/Recruit\/GI_Read_Comt_Ifrm[^"<>\s]*/)?.[0]
    ?.replace(/\\u0026/g, "&")
    .replace(/\\.*/, "");
  const frame =
    $("iframe")
      .toArray()
      .map((el) => $(el).attr("src"))
      .find(
        (src) =>
          src && /GI_Read|GIB_Read|GI_Read_Comt|iframe|recruit/i.test(src),
      ) ??
    embeddedFrame ??
    null;
  return { job: j, iframe: frame };
}
export type Discovery = {
  ids: string[];
  complete: boolean;
  reason: string | null;
};
export async function discoverWanted(
  limit: number,
  deadline = Infinity,
  onCandidate: (candidate: Candidate) => void = () => {},
): Promise<Discovery> {
  const ids = new Set<string>();
  const pages = new Set<string>();
  let url: string | null =
    "https://www.wanted.co.kr/api/v4/jobs?country=kr&tag_type_ids=518&job_sort=job.latest_order&years=-1&locations=all&limit=100&offset=0";
  for (let page = 0; page < limit; page++) {
    if (Date.now() >= deadline)
      return { ids: [...ids], complete: false, reason: "time-budget" };
    try {
      const listing = z
        .object({
          data: z.array(
            z.object({
              id: z.number(),
              position: z.string(),
              company: z.object({ id: z.number() }).optional(),
            }),
          ),
          links: z.object({ next: z.string().nullable() }),
        })
        .parse(JSON.parse(await fetchHtml(url!)));
      const signature = listing.data
        .map((job) => job.id)
        .sort()
        .join(",");
      if (listing.data.length && pages.has(signature))
        return { ids: [...ids], complete: false, reason: "repeated-page" };
      pages.add(signature);
      for (const job of listing.data)
        if (relevant(job.position)) {
          ids.add(String(job.id));
          onCandidate({
            id: String(job.id),
            title: job.position,
            companyId: job.company ? String(job.company.id) : undefined,
          });
        }
      if (!listing.links.next)
        return { ids: [...ids], complete: true, reason: null };
      const next: URL = new URL(listing.links.next, url!);
      if (
        next.origin !== "https://www.wanted.co.kr" ||
        next.pathname !== "/api/v4/jobs"
      )
        throw new Error("Unexpected Wanted pagination URL");
      url = next.href;
    } catch (error) {
      if (!ids.size) throw error;
      return { ids: [...ids], complete: false, reason: listingFailure(error) };
    }
    await sleep(1000);
  }
  return { ids: [...ids], complete: false, reason: "page-limit" };
}
export async function discoverJobkorea(
  limit: number,
  deadline = Infinity,
  onCandidate: (candidate: Candidate) => void = () => {},
): Promise<Discovery> {
  const ids = new Set<string>();
  const pages = new Set<string>();
  for (let page = 1; page <= limit; page++) {
    if (Date.now() >= deadline)
      return { ids: [...ids], complete: false, reason: "time-budget" };
    let html: string;
    try {
      html = await fetchHtml(
        "https://www.jobkorea.co.kr/Recruit/Home/_GI_List/",
        {
          method: "POST",
          headers: {
            Referer:
              "https://www.jobkorea.co.kr/recruit/joblist?menucode=duty&duty=1000229,1000231,1000239,1000423",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            "condition[duty]": "1000229,1000231,1000239,1000423",
            "condition[menucode]": "",
            page: String(page),
            pagesize: "40",
            order: "20",
            tabindex: "0",
            direct: "0",
            onePick: "0",
            confirm: "0",
            profile: "0",
          }),
        },
      );
    } catch (error) {
      if (!ids.size) throw error;
      return { ids: [...ids], complete: false, reason: listingFailure(error) };
    }
    const $ = cheerio.load(html);
    const links = $('strong > a[href*="/Recruit/GI_Read/" i]')
      .toArray()
      .map((el) => ({
        href: $(el).attr("href") ?? "",
        text: $(el).text().trim(),
        companyId: $(el)
          .closest("tr")
          .find('.tplCo a[href*="/Recruit/Co_Read/" i]')
          .first()
          .attr("href")
          ?.split("?")[0]
          .split("/")
          .filter(Boolean)
          .at(-1),
      }));
    if (!links.length) {
      if (!ids.size)
        throw new Error("No Jobkorea links; layout or access changed");
      return { ids: [...ids], complete: false, reason: "listing-failed" };
    }
    const signature = [
      ...new Set(
        links.map((l) => l.href.match(/GI_Read\/(\d+)/i)?.[1]).filter(Boolean),
      ),
    ]
      .sort()
      .join(",");
    if (pages.has(signature))
      return { ids: [...ids], complete: false, reason: "repeated-page" };
    pages.add(signature);
    for (const link of links) {
      const id = link.href.match(/GI_Read\/(\d+)/i)?.[1];
      if (id && isCandidateTitle(link.text)) {
        ids.add(id);
        onCandidate({ id, title: link.text, companyId: link.companyId });
      }
    }
    const next = $("a[data-page]")
      .toArray()
      .some((el) => {
        const href = $(el).attr("href") ?? "";
        return (
          new RegExp(`[?&](?:Page|page)=${page + 1}(?:&|$)`).test(href) ||
          $(el).attr("data-page") === String(page + 1)
        );
      });
    if (!next) return { ids: [...ids], complete: true, reason: null };
    await sleep(1000);
  }
  return { ids: [...ids], complete: false, reason: "page-limit" };
}
export async function getDetail(source: Source, id: string) {
  const job = base(source, id);
  if (source === "wanted") {
    try {
      return parseWantedApi(
        JSON.parse(
          await fetchHtml(`https://www.wanted.co.kr/api/v4/jobs/${id}`),
        ),
        id,
      );
    } catch {
      return parseWanted(await fetchHtml(job.url), id);
    }
  }
  const html = await fetchHtml(job.url);
  const parsed = parseJobkorea(html, id);
  if (parsed.iframe) {
    const url = new URL(parsed.iframe, job.url);
    if (
      url.hostname === "www.jobkorea.co.kr" ||
      url.hostname === "jobkorea.co.kr"
    ) {
      const frame = cheerio.load(await fetchHtml(url.href));
      frame("script,style").remove();
      parsed.job.description +=
        "\n" + frame("body").text().replace(/\s+/g, " ").trim();
    }
  }
  parsed.job.description = publicText(parsed.job.description);
  parsed.job.skills = profile.skills.filter((s) =>
    parsed.job.description.toLowerCase().includes(s.toLowerCase()),
  );
  return parsed.job;
}
