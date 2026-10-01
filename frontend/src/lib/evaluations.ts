// Foundry Evaluations client (eps-demo-evaluations). The browser only calls this
// app's /api/evaluations routes; it never gets a Foundry token.

export interface GraderInfo {
  name: string;
  label: string;
  description: string;
  required: boolean;
  usesJudgeModel: boolean;
  type: string;
}

export interface SuiteInfo {
  name: string;
  system: string;
  judgeModel: string;
  judgeInputUsdPerMillion: number | null;
  judgeOutputUsdPerMillion: number | null;
  items: number;
  graders: GraderInfo[];
  maxRunsPerHour: number;
  maxRunsPerDay: number;
}

export interface GraderCounts {
  name: string;
  label: string;
  required: boolean;
  passed: number;
  failed: number;
  errored: number;
}

export interface RunSummary {
  evalId: string;
  evalName: string | null;
  runId: string;
  name: string | null;
  status: string;
  active: boolean;
  createdAt: string | null;
  durationSeconds: number | null;
  startedFromSite: boolean;
  appVersion: string | null;
  answerModel: string | null;
  foundryCounts: { total: number; passed: number; failed: number; errored: number };
  perGrader: GraderCounts[];
  portalUrl: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
}

export interface GraderResult {
  name: string;
  label: string;
  required: boolean;
  status: string;
  passed: boolean | null;
  score: number | null;
  threshold: number | null;
  resultLabel: string | null;
  reason: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
}

export type Verdict = "passed" | "failed" | "not_scored";

export interface EvaluationItem {
  id: string | null;
  family: string | null;
  query: string | null;
  persona: string | null;
  settings: string | null;
  expected_behavior: string | null;
  expected_tool: string | null;
  selected_tool: string | null;
  expected_outcome: string | null;
  governed_outcome: string | null;
  governed_reason: string | null;
  expected_masked_text: string | null;
  governed_reply: string | null;
  no_rules_result: string | null;
  answer_model: string | null;
  verdict: Verdict;
  results: GraderResult[];
}

export interface RunUsage {
  judgeModel: string;
  judgeCalls: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number | null;
  answerModel: string | null;
  answerInputTokens: number | null;
  answerOutputTokens: number | null;
  answerCostUsd: number | null;
}

export interface RunDetail {
  run: RunSummary;
  score: { total: number; passed: number; failed: number; notScored: number };
  usage: RunUsage;
  items: EvaluationItem[];
}

export interface EvaluationOverview {
  available: boolean;
  reason: string | null;
  canStart: boolean;
  portalUrl: string | null;
  project: string | null;
  suite: SuiteInfo;
  runs: RunSummary[];
  example: RunDetail | null;
  refreshedAt: string | null;
}

export class EvaluationApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

const EVAL_ID = /^eval_[0-9a-f]{32}$/;
const RUN_ID = /^evalrun_[0-9a-f]{32}$/;

export function isEvalId(value: string | null | undefined): value is string {
  return typeof value === "string" && EVAL_ID.test(value);
}

export function isRunId(value: string | null | undefined): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

/** `#/evaluations?run=<evalId>/<runId>` deep links. Anything else is ignored. */
export function parseRunRef(value: string | null): { evalId: string; runId: string } | null {
  const [evalId, runId] = (value ?? "").split("/");
  return isEvalId(evalId) && isRunId(runId) ? { evalId, runId } : null;
}

/** Only links into the Foundry portal are shown. */
export function safePortalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "ai.azure.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

type Fetch = typeof fetch;

async function failure(response: Response): Promise<EvaluationApiError> {
  let code = "http_error";
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    code = body.error ?? code;
    message = body.message ?? message;
  } catch {
    // Keep the generic message.
  }
  const retry = Number(response.headers.get("Retry-After"));
  return new EvaluationApiError(
    response.status,
    code,
    message,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}

export async function getEvaluations(fetcher: Fetch = fetch): Promise<EvaluationOverview> {
  const response = await fetcher("/api/evaluations", { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as EvaluationOverview;
}

export async function getEvaluationRun(
  evalId: string,
  runId: string,
  fetcher: Fetch = fetch,
): Promise<RunDetail> {
  if (!isEvalId(evalId) || !isRunId(runId)) {
    throw new EvaluationApiError(400, "invalid_request", "Not a Foundry evaluation run.");
  }
  const response = await fetcher(`/api/evaluations/${evalId}/runs/${runId}`, {
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as RunDetail;
}

export async function startEvaluationRun(
  presenterKey: string,
  fetcher: Fetch = fetch,
): Promise<RunSummary> {
  const response = await fetcher("/api/evaluations/runs", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Demo-Presenter-Key": presenterKey },
    body: "{}",
  });
  if (response.status !== 202) throw await failure(response);
  return (await response.json()) as RunSummary;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes ? `${minutes} min ${whole % 60} s` : `${whole} s`;
}

export function totalCost(usage: RunUsage): number | null {
  if (usage.judgeCostUsd === null && usage.answerCostUsd === null) return null;
  return (usage.judgeCostUsd ?? 0) + (usage.answerCostUsd ?? 0);
}
