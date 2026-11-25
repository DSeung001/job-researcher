import * as cheerio from "cheerio";
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
    url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`,
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
export function parseYears(text: string): {
  min: number | null;
  max: number | null;
  known: boolean;
} {
  if (/경력\s*무관|신입\s*[·/,및]\s*경력|경력\s*[·/,및]\s*신입/.test(text))
    return { min: null, max: null, known: true };
  const range = text.match(/(\d+)\s*년?\s*[~～-]\s*(\d+)\s*년/);
  if (range)
    return { min: Number(range[1]), max: Number(range[2]), known: true };
  const min = text.match(/(\d+)\s*년/);
  if (min) return { min: Number(min[1]), max: null, known: true };
  if (/신입/.test(text)) return { min: 0, max: 0, known: true };
  return { min: null, max: null, known: false };
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
  // JSON-LD often says only "경력"; the meta summary carries "경력 : 경력 5년이상".
  const summary =
    $('meta[name="description"]')
      .attr("content")
      ?.match(/경력\s*:\s*([^,]+)/)?.[1] ?? "";
  const bodyYears =
    j.description.match(/경력\s*\d+\s*년\s*(?:이상|↑)/)?.[0] ?? "";
  const years = [summary, String(data.experienceRequirements ?? ""), bodyYears]
    .map(parseYears)
    .find((y) => y.known) ?? { min: null, max: null };
  j.minYears = years.min;
  j.maxYears = years.max;
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
