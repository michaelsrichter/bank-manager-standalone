import type { Cost, LaneResult, PolicyState, StreamEvent, ToolAction, Usage } from "../lib/types";

export const MAX_THREADS = 10;
export const MAX_TURNS = 20;
const KEY = "bm.threads.v1";

export type TurnStatus = "streaming" | "done" | "error" | "rate_limited" | "stalled";
export type ApprovalState = "pending" | "resolving" | "approved" | "rejected";

export interface StepState {
  id: string;
  state: string;
  status?: string;
}

export interface Turn {
  id: string;
  prompt: string;
  personaId: string;
  modelKey: string;
  modelLabel: string;
  policyState: PolicyState;
  status: TurnStatus;
  steps: StepState[];
  requestedDeployment?: string;
  responseModel?: string | null;
  usage?: Usage | null;
  cost?: Cost;
  fakeAi?: boolean;
  toolAction?: ToolAction | null;
  toolSelected?: boolean;
  baseline?: LaneResult;
  governed?: LaneResult;
  approval?: ApprovalState;
  traceId?: string;
  /** The chat this answer belongs to (`gen_ai.conversation.id`). */
  conversationId?: string;
  /** Practice skips the AI model. Never shown as a live answer. */
  practice?: boolean;
  /** When the answer finished (ISO time). Keeps review queries to a small window. */
  answeredAt?: string;
  /** Trace of the person's Approve or Reject decision, when there was one. */
  approvalTraceId?: string;
  error?: string;
  retryAfter?: number;
}

export interface Thread {
  id: string;
  personaId: string;
  createdAt: string;
  turns: Turn[];
}

export interface DemoState {
  threads: Thread[];
  currentId: string;
}

export type Action =
  | { type: "thread.new"; id: string; personaId: string; createdAt: string }
  | { type: "thread.open"; id: string }
  | { type: "thread.clear" }
  | { type: "reset"; id: string; personaId: string; createdAt: string }
  | { type: "turn.start"; turn: Turn }
  | { type: "turn.event"; turnId: string; event: StreamEvent }
  | { type: "turn.fail"; turnId: string; status: TurnStatus; error?: string; retryAfter?: number }
  | { type: "approval.resolving"; turnId: string }
  | {
      type: "approval.resolved";
      turnId: string;
      decision: "approve" | "reject";
      result: LaneResult;
      traceId?: string;
    }
  | { type: "approval.failed"; turnId: string };

export function emptyThread(id: string, personaId: string, createdAt: string): Thread {
  return { id, personaId, createdAt, turns: [] };
}

export function initialState(id: string, personaId: string, createdAt: string): DemoState {
  return { threads: [emptyThread(id, personaId, createdAt)], currentId: id };
}

export function currentThread(state: DemoState): Thread {
  return state.threads.find((thread) => thread.id === state.currentId) ?? state.threads[0];
}

function updateTurn(state: DemoState, turnId: string, change: (turn: Turn) => Turn): DemoState {
  return {
    ...state,
    threads: state.threads.map((thread) => ({
      ...thread,
      turns: thread.turns.map((turn) => (turn.id === turnId ? change(turn) : turn)),
    })),
  };
}

function withStep(steps: StepState[], step: StepState): StepState[] {
  const index = steps.findIndex((existing) => existing.id === step.id);
  if (index === -1) return [...steps, step];
  const next = [...steps];
  next[index] = step;
  return next;
}

export function applyEvent(turn: Turn, event: StreamEvent): Turn {
  switch (event.type) {
    case "run.started":
      return {
        ...turn,
        traceId: event.traceId,
        conversationId: event.conversationId ?? turn.conversationId,
        practice: event.practice ?? turn.practice,
      };
    case "step":
      return {
        ...turn,
        steps: withStep(turn.steps, { id: event.id, state: event.state, status: event.status }),
      };
    case "model.usage":
      return {
        ...turn,
        requestedDeployment: event.requestedDeployment,
        responseModel: event.responseModel,
        usage: event.usage,
        cost: event.cost,
        fakeAi: event.fakeAi,
      };
    case "tool.selected":
      return { ...turn, toolAction: event.action, toolSelected: true };
    case "lane.result": {
      const lane = event.result.lane;
      const approval =
        lane === "governed" && event.result.status === "approval" ? "pending" : turn.approval;
      return { ...turn, [lane]: event.result, approval };
    }
    case "run.completed":
      return { ...turn, status: "done", answeredAt: new Date().toISOString() };
    case "error":
      return {
        ...turn,
        status: "error",
        error: event.message,
        traceId: event.traceId ?? turn.traceId,
      };
  }
}

export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "thread.new": {
      const threads = [emptyThread(action.id, action.personaId, action.createdAt), ...state.threads]
        .filter((thread, index) => index === 0 || thread.turns.length > 0)
        .slice(0, MAX_THREADS);
      return { threads, currentId: action.id };
    }
    case "thread.open":
      return state.threads.some((thread) => thread.id === action.id)
        ? { ...state, currentId: action.id }
        : state;
    case "thread.clear":
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === state.currentId ? { ...thread, turns: [] } : thread,
        ),
      };
    case "reset":
      return initialState(action.id, action.personaId, action.createdAt);
    case "turn.start":
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === state.currentId
            ? { ...thread, turns: [...thread.turns, action.turn].slice(-MAX_TURNS) }
            : thread,
        ),
      };
    case "turn.event":
      return updateTurn(state, action.turnId, (turn) => applyEvent(turn, action.event));
    case "turn.fail":
      return updateTurn(state, action.turnId, (turn) => ({
        ...turn,
        status: action.status,
        error: action.error,
        retryAfter: action.retryAfter,
      }));
    case "approval.resolving":
      return updateTurn(state, action.turnId, (turn) => ({ ...turn, approval: "resolving" }));
    case "approval.resolved":
      return updateTurn(state, action.turnId, (turn) => ({
        ...turn,
        governed: action.result,
        approval: action.decision === "approve" ? "approved" : "rejected",
        approvalTraceId: action.traceId ?? turn.approvalTraceId,
      }));
    case "approval.failed":
      return updateTurn(state, action.turnId, (turn) => ({ ...turn, approval: "pending" }));
  }
}

export function loadState(storage: Storage, fallback: DemoState): DemoState {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? "null") as DemoState | null;
    if (!parsed || !Array.isArray(parsed.threads) || parsed.threads.length === 0) return fallback;
    const threads = parsed.threads.slice(0, MAX_THREADS).map((thread) => ({
      ...thread,
      turns: thread.turns
        .slice(-MAX_TURNS)
        .map((turn) =>
          turn.status === "streaming" ? { ...turn, status: "stalled" as const } : turn,
        ),
    }));
    const currentId = threads.some((thread) => thread.id === parsed.currentId)
      ? parsed.currentId
      : threads[0].id;
    return { threads, currentId };
  } catch {
    return fallback;
  }
}

export function saveState(storage: Storage, state: DemoState): void {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage quota errors only lose history; the live demo keeps working.
  }
}

export function clearState(storage: Storage): void {
  storage.removeItem(KEY);
}
