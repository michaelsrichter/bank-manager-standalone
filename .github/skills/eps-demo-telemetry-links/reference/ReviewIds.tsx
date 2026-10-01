// Reference: the "IDs and observability links" disclosure under an answer.
// Closed by default, so the public view stays simple. Presenters open it to
// copy IDs and jump into Azure Monitor.
import { useEffect, useState } from 'react'
import CopyButton from './CopyButton'
import {
  answerReviewWorkbookUrl, answerStepsKql, appInsightsLogsUrl, conversationKql, isConversationId, isTraceId,
  logsQueryUrl, windowAround, type ObservabilityConfig,
} from './observability-links'

export type ReviewId = { label: string; value: string; help?: string }

type Props = {
  config: ObservabilityConfig
  traceId: string
  conversationId: string
  /** Other IDs worth keeping, such as the agent name and version, model, answer time, or a request ID. */
  extraIds?: ReviewId[]
  /** When the answer finished (ISO time). Used to keep queries to a small time window. */
  answeredAt?: string
  /** Practice or replay answers are never recorded, so they get no links. */
  practice: boolean
}

export default function ReviewIds({ config, traceId, conversationId, extraIds = [], answeredAt, practice }: Props) {
  const recorded = !practice && isTraceId(traceId)
  const recordedChat = recorded && isConversationId(conversationId)
  const window = windowAround([answeredAt], config.windowMinutes ?? 60)
  const from = window?.from
  const to = window?.to
  const [answerLink, setAnswerLink] = useState<string | null>(null)

  useEffect(() => {
    if (!recorded) return
    let current = true
    void logsQueryUrl(config, answerStepsKql(traceId), from && to ? { from, to } : null)
      .then((url) => { if (current) setAnswerLink(url) })
      .catch(() => { if (current) setAnswerLink(null) })
    return () => { current = false }
  }, [config, recorded, traceId, from, to])

  const ids: ReviewId[] = [
    { label: 'Trace ID', value: traceId, help: 'One answer. Every step of it shares this ID.' },
    { label: 'Conversation ID', value: conversationId, help: 'The whole chat. Every question in it shares this ID.' },
    ...extraIds,
  ]
  const workbook = answerReviewWorkbookUrl(config)

  return (
    <details className="review-ids">
      <summary>IDs and observability links</summary>
      <p>Copy these to find this answer, or the whole chat, in Azure Monitor. Telemetry never holds the question or the answer.</p>
      <dl>
        {ids.map((id) => (
          <div key={id.label}>
            <dt>{id.label}</dt>
            <dd>
              <code>{id.value}</code>
              <CopyButton text={id.value} label={id.label} />
              {id.help && <small>{id.help}</small>}
            </dd>
          </div>
        ))}
      </dl>
      {!recorded ? (
        <p>Practice answers are not recorded, so there are no observability links for this answer.</p>
      ) : (
        <>
          <p>You need Azure access to the demo's monitoring resources to open these links.</p>
          <ul>
            {answerLink && (
              <li>
                <a href={answerLink} target="_blank" rel="noreferrer">This answer in Logs</a>
                <CopyButton text={answerLink} label="Logs link for this answer" />
              </li>
            )}
            {workbook && (
              <li>
                <a href={workbook} target="_blank" rel="noreferrer">Answer review workbook</a>
                <CopyButton text={workbook} label="Answer review workbook link" />
                <small>Paste the trace ID or conversation ID into the workbook.</small>
              </li>
            )}
            <li>
              <a href={appInsightsLogsUrl(config)} target="_blank" rel="noreferrer">Application Insights Logs</a>
              <small>Paste a query below.</small>
            </li>
          </ul>
          <h3>Query: every step of this answer</h3>
          <CopyButton text={answerStepsKql(traceId)} label="query for this answer" />
          <pre><code>{answerStepsKql(traceId)}</code></pre>
          {recordedChat && (
            <>
              <h3>Query: the whole chat as one row</h3>
              <CopyButton text={conversationKql(conversationId)} label="query for the whole chat" />
              <pre><code>{conversationKql(conversationId)}</code></pre>
            </>
          )}
        </>
      )}
    </details>
  )
}
