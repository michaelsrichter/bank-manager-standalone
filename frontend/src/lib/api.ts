import type {
  AppConfig,
  HealthSnapshot,
  LaneResult,
  PolicyState,
  StreamEvent,
  ToolAction,
} from "./types";

export class RateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("rate_limited");
  }
}

export class StreamStalledError extends Error {
  constructor() {
    super("stream_stalled");
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CompareBody {
  prompt: string;
  personaId: string;
  modelKey: string;
  policyState: PolicyState;
}

type Fetch = typeof fetch;

function headers(sessionId: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Demo-Session": sessionId };
}

async function failure(response: Response): Promise<Error> {
  if (response.status === 429) {
    return new RateLimitedError(Number(response.headers.get("Retry-After") ?? "30") || 30);
  }
  let code = "http_error";
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    code = body.error ?? code;
    message = body.message ?? message;
  } catch {
    // Non-JSON error bodies keep the generic message.
  }
  return new ApiError(response.status, code, message);
}

export async function getConfig(fetcher: Fetch = fetch): Promise<AppConfig> {
  const response = await fetcher("/api/config");
  if (!response.ok) throw await failure(response);
  return (await response.json()) as AppConfig;
}

export async function getHealth(fetcher: Fetch = fetch): Promise<HealthSnapshot> {
  const response = await fetcher("/api/health");
  if (response.status !== 200 && response.status !== 503) throw await failure(response);
  return (await response.json()) as HealthSnapshot;
}

export async function resolveApproval(
  body: {
    action: ToolAction;
    personaId: string;
    policyState: PolicyState;
    decision: "approve" | "reject";
  },
  sessionId: string,
  fetcher: Fetch = fetch,
): Promise<{ result: LaneResult; traceId: string }> {
  const response = await fetcher("/api/approval", {
    method: "POST",
    headers: headers(sessionId),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as { result: LaneResult; traceId: string };
}

export function sendPageView(page: string, fetcher: Fetch = fetch): void {
  void fetcher("/api/telemetry/page-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page }),
  }).catch(() => undefined);
}

/**
 * Streams ordered NDJSON events. Events are delivered once, in sequence order;
 * duplicates or stale sequence numbers are ignored. If no event arrives for
 * `stallMs`, the stream is aborted with StreamStalledError.
 */
export async function streamCompare(
  body: CompareBody,
  sessionId: string,
  onEvent: (event: StreamEvent) => void,
  options: { fetcher?: Fetch; stallMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const { fetcher = fetch, stallMs = 45_000, signal } = options;
  const response = await fetcher("/api/compare", {
    method: "POST",
    headers: headers(sessionId),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw await failure(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastSeq = 0;

  const deliver = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.seq <= lastSeq) return;
    lastSeq = event.seq;
    onEvent(event);
  };

  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StreamStalledError()), stallMs);
    });
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await Promise.race([reader.read(), stalled]);
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(deliver);
  }
  deliver(buffer + decoder.decode());
}
