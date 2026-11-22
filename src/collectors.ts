import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { Job, Source } from "./model.js";
import profile from "../config/profile.public.json";
import { isCandidateTitle } from "./matching.js";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function fetchHtml(url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        headers: { "User-Agent": "JobResearcher/0.1 (personal job discovery)" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt === 2) throw e;
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
  if (!data || String(data.id) !== id) throw new Error("Missing Wanted detail");
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
): Promise<Discovery> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "JobResearcher/0.1 (personal job discovery)",
      locale: "ko-KR",
    });
    const listingUrl =
      "https://www.wanted.co.kr/wdlist/518?country=kr&job_sort=job.latest_order&years=-1&locations=all";
    let response = await page.goto(listingUrl, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() === 403) {
      // Use the same public document through our HTTP client when the browser
      // transport is rejected. No credentials or private endpoints are used.
      const html = await fetchHtml(listingUrl);
      await page.route(listingUrl, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: html }),
      );
      response = await page.goto(listingUrl, { waitUntil: "domcontentloaded" });
    }
    if (!response?.ok())
      throw new Error(
        `Wanted listing HTTP ${response?.status() ?? "no-response"}`,
      );
    await page.locator('a[href*="/wd/"]').first().waitFor({ timeout: 30000 });
    const ids = new Set<string>();
    let stable = 0;
    for (let step = 0; step < limit; step++) {
      if (Date.now() >= deadline)
        return { ids: [...ids], complete: false, reason: "time-budget" };
      const links = await page.locator('a[href*="/wd/"]').evaluateAll((nodes) =>
        nodes.map((n) => ({
          href: n.getAttribute("href") ?? "",
          text: n.textContent ?? "",
        })),
      );
      const before = ids.size;
      for (const link of links) {
        const match = link.href.match(/\/wd\/(\d+)/);
        if (match && relevant(link.text)) ids.add(match[1]);
      }
      const total = await page.locator('a[href*="/wd/"]').count();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1600);
      const after = await page.locator('a[href*="/wd/"]').count();
      stable = after === total && before === ids.size ? stable + 1 : 0;
      if (stable >= 4) return { ids: [...ids], complete: true, reason: null };
    }
    return { ids: [...ids], complete: false, reason: "scroll-limit" };
  } finally {
    await browser.close();
  }
}
export async function discoverJobkorea(
  limit: number,
  deadline = Infinity,
): Promise<Discovery> {
  const ids = new Set<string>();
  const pages = new Set<string>();
  for (let page = 1; page <= limit; page++) {
    if (Date.now() >= deadline)
      return { ids: [...ids], complete: false, reason: "time-budget" };
    const html = await fetchHtml(
      `https://www.jobkorea.co.kr/recruit/joblist?menucode=duty&duty=1000229,1000231&Page=${page}`,
    );
    const $ = cheerio.load(html);
    const links = $('#dev-gi-list strong > a[href*="/Recruit/GI_Read/" i]')
      .toArray()
      .map((el) => ({
        href: $(el).attr("href") ?? "",
        text: $(el).text().trim(),
      }));
    if (!links.length)
      throw new Error("No Jobkorea links; layout or access changed");
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
      if (id && isCandidateTitle(link.text)) ids.add(id);
    }
    const next = $("#dev-gi-list a[data-page]")
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
  if (source === "wanted") return parseWanted(html, id);
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
