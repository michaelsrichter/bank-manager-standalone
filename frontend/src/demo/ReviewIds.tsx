// The "IDs and observability links" disclosure under an answer.
// Closed by default, so the public view stays simple. Presenters open it to
// copy IDs and jump into Azure Monitor.
import { useEffect, useState } from "react";
import { CopyButton } from "../components/CopyButton";
import { t } from "../i18n";
import {
  answerReviewWorkbookUrl,
  answerStepsKql,
  appInsightsLogsUrl,
  conversationKql,
  isConversationId,
  isTraceId,
  logsQueryUrl,
  overviewWorkbookUrl,
  windowAround,
} from "../lib/observability-links";
import type { ObservabilityConfig } from "../lib/types";
import type { Turn } from "./state";

interface ReviewId {
  label: string;
  value: string;
  help?: string;
}

function safe<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

interface Props {
  turn: Turn;
  config?: ObservabilityConfig | null;
}

export function ReviewIds({ turn, config }: Props) {
  const s = t().demo;
  const r = s.review;
  const traceId = turn.traceId ?? "";
  const conversationId = turn.conversationId ?? "";
  const recorded = !turn.practice && isTraceId(traceId) && Boolean(config);
  const recordedChat = recorded && isConversationId(conversationId);
  const window = windowAround([turn.answeredAt]);
  const from = window?.from;
  const to = window?.to;
  const [answerLink, setAnswerLink] = useState<string | null>(null);

  useEffect(() => {
    if (!recorded || !config || typeof CompressionStream === "undefined") return;
    let current = true;
    logsQueryUrl(config, answerStepsKql(traceId), from && to ? { from, to } : null)
      .then((url) => {
        if (current) setAnswerLink(url);
      })
      .catch(() => {
        if (current) setAnswerLink(null);
      });
    return () => {
      current = false;
    };
  }, [config, recorded, traceId, from, to]);

  if (!traceId && !conversationId) return null;

  const ids: ReviewId[] = [];
  if (traceId) ids.push({ label: s.traceId, value: traceId, help: r.traceHelp });
  if (conversationId)
    ids.push({ label: r.conversationLabel, value: conversationId, help: r.conversationHelp });
  if (turn.responseModel) ids.push({ label: r.modelLabel, value: turn.responseModel });
  if (turn.answeredAt) ids.push({ label: r.answeredLabel, value: turn.answeredAt });
  if (turn.approvalTraceId)
    ids.push({ label: r.approvalLabel, value: turn.approvalTraceId, help: r.approvalHelp });

  const workbook = config ? safe(() => answerReviewWorkbookUrl(config)) : null;
  const overview = config ? safe(() => overviewWorkbookUrl(config)) : null;
  const logs = config ? safe(() => appInsightsLogsUrl(config)) : null;

  return (
    <details className="review-ids">
      <summary>{r.title}</summary>
      <p>{r.intro}</p>
      <dl>
        {ids.map((id) => (
          <div key={id.label}>
            <dt>{id.label}</dt>
            <dd>
              <code>{id.value}</code> <CopyButton text={id.value} label={id.label} />
              {id.help && <small>{id.help}</small>}
            </dd>
          </div>
        ))}
      </dl>
      {turn.practice ? (
        <p>{r.practiceNote}</p>
      ) : !recorded || !logs ? (
        <p>{r.notConfigured}</p>
      ) : (
        <>
          <p className="muted">{r.accessNote}</p>
          <ul className="review-links">
            {answerLink && (
              <li>
                <a href={answerLink} target="_blank" rel="noreferrer">
                  {r.answerInLogs}
                </a>{" "}
                <CopyButton text={answerLink} label={r.answerInLogsCopy} />
              </li>
            )}
            {workbook && (
              <li>
                <a href={workbook} target="_blank" rel="noreferrer">
                  {r.workbook}
                </a>{" "}
                <CopyButton text={workbook} label={r.workbookCopy} />
                <small>{r.workbookHelp}</small>
              </li>
            )}
            {overview && (
              <li>
                <a href={overview} target="_blank" rel="noreferrer">
                  {r.overview}
                </a>
              </li>
            )}
            <li>
              <a href={logs} target="_blank" rel="noreferrer">
                {r.logs}
              </a>
              <small>{r.logsHelp}</small>
            </li>
          </ul>
          <h5>{r.answerQuery}</h5>
          <CopyButton text={answerStepsKql(traceId)} label={r.answerQueryCopy} />
          <pre>
            <code>{answerStepsKql(traceId)}</code>
          </pre>
          {recordedChat && (
            <>
              <h5>{r.chatQuery}</h5>
              <CopyButton text={conversationKql(conversationId)} label={r.chatQueryCopy} />
              <pre>
                <code>{conversationKql(conversationId)}</code>
              </pre>
            </>
          )}
        </>
      )}
    </details>
  );
}
