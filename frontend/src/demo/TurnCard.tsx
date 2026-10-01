import { Skeleton, StatusBadge } from "../components/Skeleton";
import { t } from "../i18n";
import { formatUsd } from "../lib/format";
import type { LaneResult, ObservabilityConfig, ToolAction } from "../lib/types";
import { ReviewIds } from "./ReviewIds";
import type { Turn } from "./state";

const STEP_ORDER = ["route", "baseline", "governed.input", "governed.pre_tool", "governed.tool"];

function describeAction(action: ToolAction): string {
  const args = Object.entries(action.args)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `${action.tool_name}(${args})`;
}

function StepList({ turn }: { turn: Turn }) {
  const s = t().demo;
  const steps = [...turn.steps].sort((a, b) => STEP_ORDER.indexOf(a.id) - STEP_ORDER.indexOf(b.id));
  return (
    <ol className="steps" aria-live="polite">
      {steps.map((step) => (
        <li key={step.id} className={`step ${step.state}`}>
          <span className="step-icon" aria-hidden="true">
            {step.state === "completed" ? "✓" : step.state === "failed" ? "✕" : "…"}
          </span>
          {s.steps[step.id] ?? step.id}
          {step.status ? (
            <>
              {" "}
              <StatusBadge status={step.status} label={s.status[step.status] ?? step.status} />
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

interface LaneProps {
  lane: "baseline" | "governed";
  result?: LaneResult;
  streaming: boolean;
  approval?: Turn["approval"];
  onDecision?: (decision: "approve" | "reject") => void;
}

function Lane({ lane, result, streaming, approval, onDecision }: LaneProps) {
  const s = t().demo;
  return (
    <section className={`lane ${lane}`} aria-label={lane === "baseline" ? s.baseline : s.governed}>
      <h4>{lane === "baseline" ? s.baseline : s.governed}</h4>
      <p className="lane-note">{lane === "baseline" ? s.baselineNote : s.governedNote}</p>
      {!result && streaming && <Skeleton lines={2} />}
      {result && (
        <>
          <p>
            <StatusBadge status={result.status} label={s.status[result.status] ?? result.status} />{" "}
            <span className="muted">
              {result.toolExecuted ? s.toolRan : s.toolBlocked} · {s.reason}:{" "}
              <code>{result.reason}</code>
            </span>
          </p>
          {result.text ? (
            <pre className="lane-output">{result.text}</pre>
          ) : (
            <p className="lane-message">{result.message}</p>
          )}
          {lane === "governed" && result.status === "approval" && approval !== "rejected" && (
            <div className="approval" role="group" aria-label={s.approvalNeeded}>
              <p>{s.approvalNeeded}</p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={approval === "resolving"}
                  onClick={() => onDecision?.("approve")}
                >
                  {s.approve}
                </button>
                <button
                  type="button"
                  disabled={approval === "resolving"}
                  onClick={() => onDecision?.("reject")}
                >
                  {s.reject}
                </button>
              </div>
              {approval === "resolving" && <p className="muted">{s.resolving}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ModelEvidence({ turn }: { turn: Turn }) {
  const s = t().demo;
  if (!turn.requestedDeployment) return null;
  const usage = turn.usage;
  return (
    <details className="evidence">
      <summary>
        {s.modelEvidence}: {turn.modelLabel} ·{" "}
        {turn.fakeAi ? s.fakeCost : formatUsd(turn.cost?.totalUsd)}
      </summary>
      <dl>
        <dt>{s.requestedModel}</dt>
        <dd>
          <code>{turn.requestedDeployment}</code>
        </dd>
        <dt>{s.actualModel}</dt>
        <dd>
          <code>{turn.responseModel ?? s.unavailable}</code>
        </dd>
        <dt>{s.tokens}</dt>
        <dd>
          {usage
            ? `${usage.inputTokens} / ${usage.cachedInputTokens} / ${usage.outputTokens} / ${usage.reasoningTokens}`
            : s.unavailable}
        </dd>
        <dt>{s.cost}</dt>
        <dd>
          {turn.fakeAi
            ? s.fakeCost
            : `${formatUsd(turn.cost?.totalUsd)} (${turn.cost?.confidence ?? "unavailable"})`}
        </dd>
      </dl>
    </details>
  );
}

interface Props {
  turn: Turn;
  index: number;
  onDecision: (turn: Turn, decision: "approve" | "reject") => void;
  observability?: ObservabilityConfig | null;
}

export function TurnCard({ turn, index, onDecision, observability }: Props) {
  const s = t().demo;
  const streaming = turn.status === "streaming";
  return (
    <article className="turn" aria-busy={streaming}>
      <header className="turn-header">
        <h3>
          {s.request} {index + 1}
        </h3>
        <q>{turn.prompt}</q>
        {turn.practice && <span className="badge practice">{s.practiceBadge}</span>}
      </header>
      <StepList turn={turn} />
      {turn.toolSelected && (
        <p className="tool-picked">
          {s.toolPicked}:{" "}
          {turn.toolAction ? <code>{describeAction(turn.toolAction)}</code> : <em>{s.noTool}</em>}
        </p>
      )}
      {(turn.status === "error" || turn.status === "stalled") && (
        <div className="alert error" role="alert">
          {turn.status === "stalled" ? s.stalled : (turn.error ?? s.failed)}
          {turn.traceId ? (
            <>
              {" "}
              ({s.traceId}: <code>{turn.traceId}</code>)
            </>
          ) : null}
        </div>
      )}
      {turn.status === "rate_limited" && (
        <div className="alert warn" role="alert">
          {s.rateLimited(turn.retryAfter ?? 30)}
        </div>
      )}
      {(turn.baseline || turn.governed || streaming) && (
        <div className="lanes">
          <Lane lane="baseline" result={turn.baseline} streaming={streaming} />
          <Lane
            lane="governed"
            result={turn.governed}
            streaming={streaming}
            approval={turn.approval}
            onDecision={(decision) => onDecision(turn, decision)}
          />
        </div>
      )}
      <ModelEvidence turn={turn} />
      {turn.status !== "streaming" && <ReviewIds turn={turn} config={observability} />}
    </article>
  );
}
