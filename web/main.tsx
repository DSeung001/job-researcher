import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Job, State, Run } from "../src/model";
import "./style.css";
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
    [notice, setNotice] = useState("");
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
        <div className="brand">
          Job Researcher <span>개인 채용 탐색기</span>
        </div>
        <button
          onClick={() => {
            setOrigins(state?.origins.join(", ") ?? "");
            setSettings(!settings);
          }}
        >
          설정
        </button>
      </header>
      <section className="intro">
        <div>
          <h1>다음으로 살펴볼 회사</h1>
          <p>지원할 수 있는 기회를 넓게 보고, 관심 가는 회사를 남겨두세요.</p>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => void act("sync", {})}>
            공고 데이터 갱신
          </button>
          <button
            className="primary"
            disabled={busy || data?.collecting}
            onClick={() => void act("collect", {})}
          >
            {data?.collecting ? "수집 중…" : "지금 수집"}
          </button>
        </div>
      </section>
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
      <div className="health">
        {data?.runs.map((r) => (
          <span key={r.source}>
            {r.source === "wanted" ? "원티드" : "잡코리아"}{" "}
            <strong>
              {!r.at ? "수집 전" : r.success ? "수집 완료" : "불완전 수집"}
            </strong>
            {r.at && (
              <>
                {" "}
                · {new Date(r.at).toLocaleString("ko-KR")} · {r.fetched}건
              </>
            )}
            {r.reason && <small> ({collectionReason(r.reason)})</small>}
          </span>
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
            commute = state?.commutes[key];
          return (
            <article className="company" key={key}>
              <div className="company-head">
                <div>
                  <h2>{jobs[0].companyName}</h2>
                  <span className="muted">
                    공고 {jobs.length}개 · 통근{" "}
                    {commute ? `${commute.minutes}분` : "미확인"}
                  </span>
                </div>
                <div className="actions">
                  <button
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
                    {flags?.isInterested ? "관심 해제" : "관심 회사"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "company",
                        { key, isSkipped: !flags?.isSkipped },
                        "PATCH",
                      )
                    }
                  >
                    {flags?.isSkipped ? "스킵 해제" : "회사 스킵"}
                  </button>
                </div>
              </div>
              {jobs.map((job) => (
                <section className="job" key={job.key}>
                  <div className="job-title">
                    <a href={job.url} target="_blank" rel="noreferrer">
                      {job.title}
                    </a>
                    {job.isNew && <span className="badge">신규</span>}
                    {job.isUpdated && <span className="badge">수정</span>}
                    <span className="muted">
                      {job.status === "closed"
                        ? "마감"
                        : job.status === "unknown"
                          ? "채용 상태 미확인"
                          : ""}
                    </span>
                  </div>
                  <p className="muted">
                    {job.source === "wanted" ? "원티드" : "잡코리아"} ·{" "}
                    {job.location || "위치 미확인"} · 경력{" "}
                    {job.minYears === null
                      ? "미확인"
                      : `${job.minYears}년 이상`}
                  </p>
                  <p className="reasons">
                    {job.reasons.join(" / ") ||
                      "적합 조건을 직접 확인해 주세요."}
                  </p>
                  <details>
                    <summary>공고 내용</summary>
                    <p className="description">{job.description}</p>
                  </details>
                  <label className="applied">
                    <input
                      type="checkbox"
                      checked={job.isApplied}
                      onChange={(e) =>
                        void act(
                          "job",
                          { key: job.key, isApplied: e.target.checked },
                          "PATCH",
                        )
                      }
                    />
                    지원 완료
                  </label>
                </section>
              ))}
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
                          void act("link", { from: e.target.value, to: key });
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
