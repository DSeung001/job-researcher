import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Job, State, Run } from "../src/model";
import "./style.css";
import { statusLabel } from "../src/collection-status";
type ViewJob = Job & {
  score: number;
  reasons: string[];
  isNew: boolean;
  isUpdated: boolean;
  isApplied: boolean;
  companyKey: string;
  originalCompanyKey: string;
};
type Dashboard = {
  jobs: ViewJob[];
  state: State;
  runs: (Run & { source: string })[];
  collecting: boolean;
};
const collectionReason = (reason: string | null) =>
  reason === "listing-http-403"
    ? "사이트에서 자동 접근을 제한했습니다."
    : reason === "time-budget"
      ? "이번 실행의 수집 시간을 모두 사용했습니다. 다음 실행에서 이어서 확인합니다."
      : reason === "detail-failures"
        ? "일부 공고의 상세 내용을 확인하지 못했습니다."
        : reason === "detail-limit" ||
            reason === "page-limit" ||
            reason === "scroll-limit"
          ? "설정된 수집 범위까지 확인했습니다."
          : reason === "repeated-page"
            ? "목록이 반복되어 수집을 멈췄습니다."
            : reason
              ? "일부 공고를 확인하지 못했습니다."
              : "";
async function api(path: string, body?: unknown, method = "POST") {
  const r = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}
function Icon({ symbol }: { symbol: string }) {
  return <span aria-hidden="true">{symbol}</span>;
}
function period(job: ViewJob) {
  if (job.status === "closed") return "마감";
  if (!job.deadline) return "기간 미확인";
  const date = job.deadline.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date ? "~ " + date.replaceAll("-", ".") : job.deadline;
}
function App() {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("all"),
    [source, setSource] = useState("all"),
    [onlyNew, setOnlyNew] = useState(false),
    [showClosed, setShowClosed] = useState(false),
    [settings, setSettings] = useState(false),
    [origins, setOrigins] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(
      new Set(),
    );
  async function load() {
    try {
      setData(await api("dashboard"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  async function act(path: string, body: unknown, method = "POST") {
    setBusy(true);
    try {
      await api(path, body, method);
      await load();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const state = data?.state;
  const grouped = new Map<string, ViewJob[]>();
  for (const job of data?.jobs ?? []) {
    const flags = state?.companies[job.companyKey];
    if (tab === "skipped" ? !flags?.isSkipped : flags?.isSkipped) continue;
    if (tab === "interested" && !flags?.isInterested) continue;
    if (tab === "applied" && !job.isApplied) continue;
    if (!showClosed && job.status === "closed") continue;
    if (source !== "all" && job.source !== source) continue;
    if (onlyNew && !job.isNew && !job.isUpdated) continue;
    if (
      query &&
      ![job.companyName, job.title, job.location, job.description]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      continue;
    grouped.set(job.companyKey, [...(grouped.get(job.companyKey) ?? []), job]);
  }
  const groups = [...grouped.entries()]
    .map(([key, jobs]) => ({
      key,
      jobs: jobs.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => b.jobs[0].score - a.jobs[0].score);
  return (
    <main>
      <header>
        <h1 className="brand">Job Researcher</h1>
        <div className="actions header-actions">
          <button disabled={busy} onClick={() => void act("sync", {})}>
            데이터 갱신
          </button>
          <button
            className="primary"
            disabled={busy || data?.collecting}
            onClick={() => void act("collect", {})}
          >
            {data?.collecting ? "수집 중…" : "지금 수집"}
          </button>
          <button
            onClick={() => {
              setOrigins(state?.origins.join(", ") ?? "");
              setSettings(!settings);
            }}
            aria-expanded={settings}
          >
            설정
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {settings && (
        <section className="settings">
          <h2>로컬 설정</h2>
          <p>여기에 저장한 설정과 선택 기록은 이 PC에만 보관합니다.</p>
          <label>
            출발역 (최대 2곳, 쉼표로 구분)
            <input
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              void act("settings", {
                origins: origins
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          >
            설정 저장
          </button>
          <a href="/api/backup" download>
            개인 상태 백업
          </a>
          <label className="file">
            백업 복원
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (
                  f &&
                  confirm("현재 개인 상태를 백업 파일의 내용으로 교체할까요?")
                ) {
                  try {
                    await act("restore", JSON.parse(await f.text()));
                  } catch {
                    setError("올바른 JSON 백업 파일을 선택해 주세요.");
                  }
                }
              }}
            />
          </label>
        </section>
      )}
      <div className="health" aria-label="최근 수집 상태">
        {data?.runs.map((r) => (
          <details className="collection-status" key={r.source}>
            <summary>
              {r.source === "wanted" ? "원티드" : "잡코리아"}{" "}
              {!r.at ? "수집 전" : statusLabel(r)}
              {r.at && (
                <>
                  {" "}
                  ·{" "}
                  <time dateTime={r.at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(r.at))}
                  </time>{" "}
                  · {r.fetched}건
                </>
              )}
            </summary>
            <div className="collection-detail">
              {r.at && (
                <div>
                  {new Date(r.at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </div>
              )}
              <div>
                {r.reason
                  ? collectionReason(r.reason)
                  : r.at
                    ? "수집을 완료했습니다."
                    : "지금 수집을 눌러 공고를 가져오세요."}
              </div>
            </div>
          </details>
        ))}
      </div>
      <nav aria-label="회사 보기">
        {[
          ["all", "추천 회사"],
          ["interested", "관심 회사"],
          ["applied", "지원 완료"],
          ["skipped", "스킵한 회사"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? "selected" : ""}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="filters">
        <input
          aria-label="회사·직무 검색"
          placeholder="회사, 직무, 기술 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="사이트"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="all">모든 사이트</option>
          <option value="wanted">원티드</option>
          <option value="jobkorea">잡코리아</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={onlyNew}
            onChange={(e) => setOnlyNew(e.target.checked)}
          />
          신규·수정만
        </label>
        <label>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          마감 포함
        </label>
        <button onClick={() => void act("review", {})}>여기까지 확인</button>
      </section>
      <div className="count">
        {groups.length}개 회사 · {groups.reduce((n, g) => n + g.jobs.length, 0)}
        개 공고
        <span className="list-hint">
          회사 행을 눌러 공고 펼치기 · ☆ 관심 · » 스킵 · ✓ 지원완료
        </span>
      </div>
      {!data ? (
        <p>공고를 불러오는 중입니다.</p>
      ) : groups.length === 0 ? (
        <section className="empty">
          <h2>
            {data.jobs.length
              ? "조건에 맞는 회사가 없습니다."
              : "아직 수집한 공고가 없습니다."}
          </h2>
          <p>
            {data.jobs.length
              ? "검색 조건을 바꾸거나 스킵한 회사를 확인해 보세요."
              : "지금 수집을 누르거나 저장소의 최신 공고 데이터를 갱신해 주세요."}
          </p>
        </section>
      ) : (
        groups.map(({ key, jobs }) => {
          const flags = state?.companies[key],
            commute = state?.commutes[key],
            expanded = expandedCompanies.has(key),
            contentId = `company-${encodeURIComponent(key)}`;
          return (
            <article
              className="company"
              key={key}
              aria-label={jobs[0].companyName}
            >
              <div className="company-head">
                <button
                  className="company-toggle"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() =>
                    setExpandedCompanies((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  <span className="company-name" title={jobs[0].companyName}>
                    {jobs[0].companyName}
                  </span>
                  <span className="company-preview" title={jobs[0].title}>
                    {jobs[0].title}
                  </span>
                  <span className="company-count">공고 {jobs.length}개</span>
                  <span className="period">{period(jobs[0])}</span>
                  <span className="chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                <div className="actions">
                  <button
                    className="icon-button"
                    title={flags?.isInterested ? "관심 해제" : "관심 회사"}
                    aria-label={flags?.isInterested ? "관심 해제" : "관심 회사"}
                    aria-pressed={!!flags?.isInterested}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "company",
                        { key, isInterested: !flags?.isInterested },
                        "PATCH",
                      )
                    }
                  >
                    <Icon symbol={flags?.isInterested ? "★" : "☆"} />
                  </button>
                  <button
                    className="icon-button"
                    title={flags?.isSkipped ? "스킵 해제" : "회사 스킵"}
                    aria-label={flags?.isSkipped ? "스킵 해제" : "회사 스킵"}
                    aria-pressed={!!flags?.isSkipped}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "company",
                        { key, isSkipped: !flags?.isSkipped },
                        "PATCH",
                      )
                    }
                  >
                    <Icon symbol="»" />
                  </button>
                </div>
              </div>
              <div id={contentId} hidden={!expanded}>
                {commute && <p className="muted">통근 {commute.minutes}분</p>}
                {jobs.map((job) => (
                  <section className="job" key={job.key}>
                    <details className="job-details">
                      <summary
                        onClick={(event) => {
                          const details = event.currentTarget
                            .parentElement as HTMLDetailsElement;
                          if (
                            details.open &&
                            details.getBoundingClientRect().top < 0
                          ) {
                            event.preventDefault();
                            details.open = false;
                            details.scrollIntoView({
                              block: "start",
                              behavior: "instant",
                            });
                          }
                        }}
                      >
                        <span className="job-title-text">{job.title}</span>
                        {job.isNew && <span className="badge">신규</span>}
                        {job.isUpdated && <span className="badge">수정</span>}
                        <span className="period">{period(job)}</span>
                        <span className="collapse-label">접기</span>
                        <span className="chevron" aria-hidden="true">
                          ⌄
                        </span>
                      </summary>
                      <div className="job-content">
                        <p className="muted">
                          {job.source === "wanted" ? "원티드" : "잡코리아"} ·{" "}
                          {job.location || "위치 미확인"} · 경력{" "}
                          {job.minYears === null
                            ? "미확인"
                            : job.minYears + "년 이상"}
                          {job.status === "unknown"
                            ? " · 채용 상태 미확인"
                            : ""}
                        </p>
                        <p className="reasons">
                          {job.reasons.join(" / ") ||
                            "적합 조건을 직접 확인해 주세요."}
                        </p>
                        <h3>모집 내용</h3>
                        <p className="description">
                          {job.description.trim() ||
                            "저장된 모집 내용이 없습니다. 지금 수집으로 내용을 갱신하거나 원문을 확인해 주세요."}
                        </p>
                        <div className="content-source">
                          <span>
                            저장된 공고 · 마지막 확인{" "}
                            {new Date(job.lastSeenAt).toLocaleDateString(
                              "ko-KR",
                            )}
                          </span>
                          <a href={job.url} target="_blank" rel="noreferrer">
                            원문 보기 ↗
                          </a>
                        </div>
                      </div>
                    </details>
                    <button
                      className="icon-button applied-button"
                      title={job.isApplied ? "지원 완료 해제" : "지원 완료"}
                      aria-label={
                        job.isApplied ? "지원 완료 해제" : "지원 완료"
                      }
                      aria-pressed={job.isApplied}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "job",
                          { key: job.key, isApplied: !job.isApplied },
                          "PATCH",
                        )
                      }
                    >
                      <Icon symbol="✓" />
                    </button>
                  </section>
                ))}
                <details className="company-tools">
                  <summary>회사 관리</summary>
                  <div className="company-footer">
                    <button
                      onClick={() => {
                        const value = prompt(
                          "두 출발역 중 더 빠른 통근 시간(분)",
                          String(commute?.minutes ?? ""),
                        );
                        if (value !== null && value.trim())
                          void act("commute", { key, minutes: Number(value) });
                      }}
                    >
                      통근 시간 기록
                    </button>
                    {state?.origins.map((origin) => (
                      <a
                        key={origin}
                        href={`https://map.naver.com/p/search/${encodeURIComponent(origin + "에서 " + jobs[0].location)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {origin} 경로 확인
                      </a>
                    ))}
                    <details>
                      <summary>같은 회사 연결</summary>
                      <label>
                        다른 이름이나 사이트로 등록된 회사를 선택하세요.
                        <select
                          aria-label="연결할 회사"
                          value=""
                          onChange={(e) => {
                            if (e.target.value)
                              void act("link", {
                                from: e.target.value,
                                to: key,
                              });
                          }}
                        >
                          <option value="">회사 선택</option>
                          {[
                            ...new Map(
                              (data?.jobs ?? []).map((j) => [j.companyKey, j]),
                            ).values(),
                          ]
                            .filter((j) => j.companyKey !== key)
                            .map((j) => (
                              <option key={j.companyKey} value={j.companyKey}>
                                {j.companyName} (
                                {j.source === "wanted" ? "원티드" : "잡코리아"})
                              </option>
                            ))}
                        </select>
                      </label>
                    </details>
                  </div>
                </details>
              </div>
            </article>
          );
        })
      )}
      <footer>
        공고는 계속 수집하며, 스킵·관심·지원 기록은 로컬에 보관합니다.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
