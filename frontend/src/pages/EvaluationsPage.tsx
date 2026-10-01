import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "../components/Skeleton";
import { t } from "../i18n";
import {
  EvaluationApiError,
  formatDuration,
  getEvaluationRun,
  getEvaluations,
  parseRunRef,
  safePortalUrl,
  startEvaluationRun,
  totalCost,
  type EvaluationItem,
  type EvaluationOverview,
  type GraderCounts,
  type GraderResult,
  type RunDetail,
  type RunSummary,
} from "../lib/evaluations";
import { formatUsd } from "../lib/format";

const POLL_MS = 10_000;

type Api = {
  getEvaluations: typeof getEvaluations;
  getEvaluationRun: typeof getEvaluationRun;
  startEvaluationRun: typeof startEvaluationRun;
};

const defaultApi: Api = { getEvaluations, getEvaluationRun, startEvaluationRun };

interface Props {
  /** `<evalId>/<runId>` from `#/evaluations?run=...`. */
  runRef?: string | null;
  api?: Api;
}

function formatStarted(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
}

function StatusChip({ status }: { status: string }) {
  const s = t().evaluations;
  return (
    <span className={`eval-status eval-status-${status}`}>{s.statusLabels[status] ?? status}</span>
  );
}

function PortalLink({ href, label }: { href: string | null; label: string }) {
  const safe = safePortalUrl(href);
  if (!safe) return null;
  return (
    <a className="button" href={safe} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function requiredSummary(counts: GraderCounts[]): string {
  const required = counts.filter((entry) => entry.required);
  if (!required.length) return "—";
  return required
    .map((entry) => `${entry.label}: ${entry.passed}/${entry.passed + entry.failed}`)
    .join(" · ");
}

function GraderBar({ entry }: { entry: GraderCounts }) {
  const s = t().evaluations;
  const total = entry.passed + entry.failed + entry.errored;
  const percent = total ? Math.round((entry.passed / total) * 100) : 0;
  return (
    <li className="grader-bar">
      <div className="grader-bar-head">
        <strong>{entry.label}</strong>
        <span className={entry.required ? "tag required" : "tag info"}>
          {entry.required ? s.required : s.informational}
        </span>
        <span className="muted">
          {s.passedOf(entry.passed, entry.passed + entry.failed)}
          {entry.errored ? ` · ${s.errored(entry.errored)}` : ""}
        </span>
      </div>
      <div
        className="bar"
        role="img"
        aria-label={`${entry.label}: ${s.passedOf(entry.passed, total)}`}
      >
        <span className="bar-pass" style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

function Grade({ result }: { result: GraderResult }) {
  const s = t().evaluations;
  const state =
    result.status === "error" || result.passed === null ? "error" : result.passed ? "pass" : "fail";
  return (
    <li className={`grade grade-${state}`}>
      <span className="grade-mark" aria-hidden="true">
        {state === "pass" ? "✓" : state === "fail" ? "✕" : "!"}
      </span>
      <div>
        <strong>{result.label}</strong>{" "}
        <span className={result.required ? "tag required" : "tag info"}>
          {result.required ? s.required : s.informational}
        </span>{" "}
        <span className="grade-word">
          {state === "pass" ? s.gradePassed : state === "fail" ? s.gradeFailed : s.gradeError}
        </span>
        {result.score !== null && state !== "error" && (
          <span className="muted"> · {s.score(result.score, result.threshold)}</span>
        )}
        {result.reason && <p className="grade-reason">{result.reason}</p>}
        {result.errorMessage && <p className="grade-reason">{result.errorMessage}</p>}
      </div>
    </li>
  );
}

function Compare({
  label,
  expected,
  actual,
}: {
  label: [string, string];
  expected: string | null;
  actual: string | null;
}) {
  const match = expected !== null && expected === actual;
  return (
    <div className={match ? "compare match" : "compare differ"}>
      <dt>{label[0]}</dt>
      <dd>
        <code>{expected ?? "—"}</code>
      </dd>
      <dt>{label[1]}</dt>
      <dd>
        <code>{actual ?? "—"}</code>
      </dd>
    </div>
  );
}

function QuestionCard({ item }: { item: EvaluationItem }) {
  const s = t().evaluations;
  return (
    <article className={`eval-item verdict-${item.verdict}`}>
      <header>
        <span className={`verdict verdict-${item.verdict}`}>{s.verdicts[item.verdict]}</span>
        <span className="muted">{item.family}</span>
      </header>
      <p className="eval-query">
        <span className="visually-hidden">{s.question}: </span>
        <q>{item.query}</q>
      </p>
      <dl className="eval-facts">
        <dt>{s.settings}</dt>
        <dd>{item.settings}</dd>
        <dt>{s.expected}</dt>
        <dd>{item.expected_behavior}</dd>
      </dl>
      <dl className="eval-compare">
        <Compare
          label={[s.toolExpected, s.toolPicked]}
          expected={item.expected_tool}
          actual={item.selected_tool}
        />
        <Compare
          label={[s.decisionExpected, s.decisionMade]}
          expected={item.expected_outcome}
          actual={item.governed_outcome}
        />
      </dl>
      <p className="eval-reply-label">{s.reply}</p>
      <pre className="eval-reply">{item.governed_reply || "—"}</pre>
      <p className="muted">
        {s.noRules}: {item.no_rules_result ?? "—"}
      </p>
      <ul className="grades">
        {item.results.map((result) => (
          <Grade key={result.name} result={result} />
        ))}
      </ul>
    </article>
  );
}

function RunDetailView({ detail, recorded }: { detail: RunDetail; recorded?: boolean }) {
  const s = t().evaluations;
  const [filter, setFilter] = useState<"all" | "failed" | "not_scored">("all");
  const items = detail.items.filter((item) => filter === "all" || item.verdict === filter);
  const cost = totalCost(detail.usage);
  return (
    <section className="eval-detail" aria-labelledby="eval-detail-title" tabIndex={-1}>
      <h2 id="eval-detail-title">
        {s.detailTitle(detail.run.name ?? detail.run.runId)}{" "}
        {recorded && <span className="badge practice">{s.recordedBadge}</span>}
      </h2>
      <div className="eval-facts-row">
        <div className="fact">
          <span className="fact-value">
            {detail.score.passed} / {detail.score.total}
          </span>
          <span className="fact-label">{s.questionsPassed}</span>
        </div>
        <div className="fact">
          <span className="fact-value">{detail.score.notScored}</span>
          <span className="fact-label">{s.notScored}</span>
        </div>
        <div className="fact">
          <StatusChip status={detail.run.status} />
          <span className="fact-label">{s.colStatus}</span>
        </div>
        <div className="fact">
          <span className="fact-value">{formatDuration(detail.run.durationSeconds) ?? "—"}</span>
          <span className="fact-label">{s.duration}</span>
        </div>
        <div className="fact">
          <span className="fact-value">{formatUsd(cost)}</span>
          <span className="fact-label">{s.cost}</span>
        </div>
      </div>
      {detail.score.notScored > 0 && <p className="alert warn">{s.notScoredHelp}</p>}
      {detail.run.errorMessage && <p className="alert error">{detail.run.errorMessage}</p>}
      <p className="muted">
        {s.costHelp(formatUsd(detail.usage.judgeCostUsd), formatUsd(detail.usage.answerCostUsd))}{" "}
        {s.tokens(
          detail.usage.judgeCalls,
          detail.usage.judgeInputTokens,
          detail.usage.judgeOutputTokens,
        )}
        .
      </p>
      <details className="evidence">
        <summary>
          {s.foundryCounts}: {detail.run.foundryCounts.passed} / {detail.run.foundryCounts.total}
        </summary>
        <p>{s.foundryCountsHelp}</p>
      </details>
      <div className="button-row">
        <PortalLink href={detail.run.portalUrl} label={s.openRun} />
      </div>
      <h3>{s.graderBars}</h3>
      <ul className="grader-bars">
        {detail.run.perGrader.map((entry) => (
          <GraderBar key={entry.name} entry={entry} />
        ))}
      </ul>
      <div className="button-row" role="group" aria-label={s.filterAll}>
        {(
          [
            ["all", s.filterAll, detail.items.length],
            ["failed", s.filterFailed, detail.score.failed],
            ["not_scored", s.filterNotScored, detail.score.notScored],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} ({count})
          </button>
        ))}
      </div>
      <div className="eval-items">
        {items.map((item) => (
          <QuestionCard key={item.id ?? item.query} item={item} />
        ))}
      </div>
    </section>
  );
}

export function EvaluationsPage({ runRef = null, api = defaultApi }: Props) {
  const s = t().evaluations;
  const [overview, setOverview] = useState<EvaluationOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(() => parseRunRef(runRef));
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [key, setKey] = useState("");
  const [starting, setStarting] = useState(false);
  const [startMessage, setStartMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const value = await api.getEvaluations();
      setOverview(value);
      setLoadError(false);
      return value;
    } catch {
      setLoadError(true);
      return null;
    }
  }, [api]);

  useEffect(() => {
    let current = true;
    api
      .getEvaluations()
      .then((value) => {
        if (!current) return;
        setOverview(value);
        setLoadError(false);
      })
      .catch(() => {
        if (current) setLoadError(true);
      });
    return () => {
      current = false;
    };
  }, [api]);

  const active = useMemo(() => overview?.runs.some((run) => run.active) ?? false, [overview]);
  const selectedActive = useMemo(
    () => overview?.runs.find((run) => run.runId === selected?.runId)?.active ?? false,
    [overview, selected],
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  useEffect(() => {
    if (!selected || !overview?.available) return;
    let current = true;
    api
      .getEvaluationRun(selected.evalId, selected.runId)
      .then((value) => {
        if (!current) return;
        setDetail(value);
        setDetailError(false);
      })
      .catch(() => {
        if (current) setDetailError(true);
      });
    return () => {
      current = false;
    };
    // Reload the selected run when the list refreshes while it is still running.
  }, [api, selected, overview?.available, overview?.refreshedAt, selectedActive]);

  const select = (run: RunSummary) => {
    setSelected({ evalId: run.evalId, runId: run.runId });
    setDetail(null);
    setDetailError(false);
    window.history.replaceState(null, "", `#/evaluations?run=${run.evalId}/${run.runId}`);
    window.setTimeout(() => detailRef.current?.scrollIntoView?.({ block: "start" }), 0);
  };

  const start = async () => {
    setStarting(true);
    setStartMessage(null);
    try {
      const run = await api.startEvaluationRun(key);
      setStartMessage({ kind: "ok", text: s.started });
      setKey("");
      await load();
      select(run);
    } catch (error) {
      const text = error instanceof EvaluationApiError ? error.message : t().errors.boundary;
      setStartMessage({ kind: "error", text });
    } finally {
      setStarting(false);
    }
  };

  const suite = overview?.suite;
  const required = suite?.graders.filter((grader) => grader.required).length ?? 0;
  return (
    <article className="page evaluations-page">
      <h1>{s.title}</h1>
      <p className="lead">{s.intro}</p>
      <p>{s.whatIsTested}</p>
      {suite && (
        <div className="eval-facts-row">
          <div className="fact">
            <span className="fact-value">{suite.items}</span>
            <span className="fact-label">{s.factQuestions}</span>
          </div>
          <div className="fact">
            <span className="fact-value">
              {required} + {suite.graders.length - required}
            </span>
            <span className="fact-label">
              {s.factGraders} ({s.required.toLowerCase()} + {s.informational.toLowerCase()})
            </span>
          </div>
          <div className="fact">
            <span className="fact-value">{suite.judgeModel}</span>
            <span className="fact-label">{s.factJudge}</span>
          </div>
          <div className="fact">
            <span className="fact-value">✓</span>
            <span className="fact-label">{s.factSaved}</span>
          </div>
        </div>
      )}
      <div className="button-row">
        <PortalLink href={overview?.portalUrl ?? null} label={s.openFoundry} />
        <a className="button" href="#/docs/evaluations/README.md">
          {s.howItWorks}
        </a>
      </div>

      {!overview && !loadError && <Skeleton lines={4} label={s.loading} />}
      {loadError && (
        <div className="alert error" role="alert">
          {s.loadFailed}
        </div>
      )}

      {overview && !overview.available && (
        <>
          <div className="alert warn" role="status">
            <strong>{s.offTitle}.</strong> {overview.reason} {overview.example ? s.offExample : ""}
          </div>
          {overview.example && <RunDetailView detail={overview.example} recorded />}
        </>
      )}

      {overview?.available && (
        <section aria-labelledby="eval-runs-title">
          <div className="section-head">
            <h2 id="eval-runs-title">{s.runsTitle}</h2>
            <button type="button" onClick={() => void load()}>
              {s.refresh}
            </button>
          </div>
          {active && (
            <p className="muted" role="status">
              {s.polling}
            </p>
          )}
          {overview.runs.length === 0 ? (
            <p>{s.noRuns}</p>
          ) : (
            <div className="table-wrap">
              <table className="eval-runs" aria-labelledby="eval-runs-title">
                <thead>
                  <tr>
                    <th scope="col">{s.colStarted}</th>
                    <th scope="col">{s.colRun}</th>
                    <th scope="col">{s.colStatus}</th>
                    <th scope="col">{s.colGraders}</th>
                    <th scope="col">{s.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.runs.map((run) => (
                    <tr
                      key={run.runId}
                      aria-current={run.runId === selected?.runId ? "true" : undefined}
                    >
                      <td>{formatStarted(run.createdAt)}</td>
                      <td>
                        <code>{run.name ?? run.runId}</code>
                        {run.startedFromSite && <small className="muted"> · {s.fromSite}</small>}
                      </td>
                      <td>
                        <StatusChip status={run.status} />
                        {run.errorMessage && <small className="muted"> {run.errorMessage}</small>}
                      </td>
                      <td>{requiredSummary(run.perGrader)}</td>
                      <td>
                        <div className="button-row">
                          <button type="button" onClick={() => select(run)}>
                            {s.seeResults}
                          </button>
                          <PortalLink href={run.portalUrl} label={s.openRun} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div ref={detailRef}>
        {selected && overview?.available && !detail && !detailError && (
          <Skeleton lines={4} label={s.detailLoading} />
        )}
        {detailError && (
          <div className="alert error" role="alert">
            {s.detailFailed}
          </div>
        )}
        {detail && overview?.available && <RunDetailView detail={detail} />}
      </div>

      {suite && (
        <section aria-labelledby="eval-start-title" className="eval-start">
          <h2 id="eval-start-title">{s.startTitle}</h2>
          <ol>
            {s.startSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="muted">{s.startCost(suite.maxRunsPerHour, suite.maxRunsPerDay)}</p>
          {overview && !overview.canStart ? (
            <p className="alert warn">{s.startDisabled}</p>
          ) : (
            <form
              className="eval-start-form"
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <label htmlFor="presenter-key">{s.presenterKey}</label>
              <input
                id="presenter-key"
                type="password"
                autoComplete="off"
                value={key}
                maxLength={256}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                type="submit"
                className="primary"
                disabled={starting || active || !key.trim()}
              >
                {s.start}
              </button>
              {active && <p className="muted">{s.activeRun}</p>}
              {starting && (
                <p className="muted" role="status">
                  {s.starting}
                </p>
              )}
              {startMessage && (
                <p
                  className={startMessage.kind === "ok" ? "alert ok" : "alert error"}
                  role={startMessage.kind === "ok" ? "status" : "alert"}
                >
                  {startMessage.text}
                </p>
              )}
            </form>
          )}
        </section>
      )}

      {suite && (
        <section aria-labelledby="eval-graders-title">
          <h2 id="eval-graders-title">{s.graderTitle}</h2>
          <div className="table-wrap">
            <table aria-labelledby="eval-graders-title">
              <thead>
                <tr>
                  <th scope="col">{s.graderCol}</th>
                  <th scope="col">{s.roleCol}</th>
                  <th scope="col">{s.checksCol}</th>
                </tr>
              </thead>
              <tbody>
                {suite.graders.map((grader) => (
                  <tr key={grader.name}>
                    <td>
                      <strong>{grader.label}</strong>
                      <br />
                      <code>{grader.name}</code> · {s.graderType[grader.type] ?? grader.type}
                    </td>
                    <td>
                      <span className={grader.required ? "tag required" : "tag info"}>
                        {grader.required ? s.required : s.informational}
                      </span>
                    </td>
                    <td>{grader.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="eval-lessons-title">
        <h2 id="eval-lessons-title">{s.lessonsTitle}</h2>
        <ul>
          {s.lessons.map((lesson) => (
            <li key={lesson}>{lesson}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
