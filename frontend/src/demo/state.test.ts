import { describe, expect, it } from "vitest";
import {
  MAX_THREADS,
  MAX_TURNS,
  applyEvent,
  currentThread,
  initialState,
  loadState,
  reducer,
  saveState,
  type Turn,
} from "./state";

const policy = { restrictedMode: false, customerApproved: false, adminMode: false };

function turn(id: string, overrides: Partial<Turn> = {}): Turn {
  return {
    id,
    prompt: `prompt ${id}`,
    personaId: "M-101",
    modelKey: "gpt-4.1",
    modelLabel: "GPT-4.1",
    policyState: policy,
    status: "streaming",
    steps: [],
    ...overrides,
  };
}

const governedApproval = {
  lane: "governed" as const,
  status: "approval",
  reason: "r",
  message: "m",
  text: null,
  toolExecuted: false,
  interventionPoint: "pre_tool_call",
  policyDecision: "approval",
  action: { tool_name: "prepare_transfer", args: { account_id: "A-1001", amount: 12000 } },
};

describe("demo state", () => {
  it("applies streamed events to a turn", () => {
    let current = turn("a");
    current = applyEvent(current, {
      seq: 1,
      type: "run.started",
      traceId: "trace",
      model: { key: "k", label: "L", deployment: "d" },
    });
    current = applyEvent(current, { seq: 2, type: "step", id: "route", state: "started" });
    current = applyEvent(current, { seq: 3, type: "step", id: "route", state: "completed" });
    current = applyEvent(current, {
      seq: 4,
      type: "model.usage",
      requestedDeployment: "gpt-4.1",
      responseModel: "gpt-4.1-2025-04-14",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0 },
      cost: { currency: "USD", totalUsd: 0.1, confidence: "estimate" },
      durationMs: 5,
      fakeAi: false,
    });
    current = applyEvent(current, { seq: 5, type: "tool.selected", action: null });
    current = applyEvent(current, { seq: 6, type: "lane.result", result: governedApproval });
    current = applyEvent(current, { seq: 7, type: "run.completed", traceId: "trace" });
    expect(current.steps).toEqual([{ id: "route", state: "completed", status: undefined }]);
    expect(current.responseModel).toBe("gpt-4.1-2025-04-14");
    expect(current.approval).toBe("pending");
    expect(current.status).toBe("done");
    const failed = applyEvent(turn("b"), { seq: 1, type: "error", code: "x", message: "nope" });
    expect(failed).toMatchObject({ status: "error", error: "nope" });
  });

  it("keeps threads bounded, opens history, clears and resets", () => {
    let state = initialState("t0", "M-101", "now");
    state = reducer(state, { type: "turn.start", turn: turn("first") });
    for (let index = 1; index <= MAX_THREADS + 2; index += 1) {
      state = reducer(state, {
        type: "thread.new",
        id: `t${index}`,
        personaId: "M-101",
        createdAt: "now",
      });
      state = reducer(state, { type: "turn.start", turn: turn(`x${index}`) });
    }
    expect(state.threads).toHaveLength(MAX_THREADS);
    state = reducer(state, { type: "thread.open", id: "t5" });
    expect(currentThread(state).id).toBe("t5");
    expect(reducer(state, { type: "thread.open", id: "missing" })).toBe(state);
    state = reducer(state, { type: "thread.clear" });
    expect(currentThread(state).turns).toHaveLength(0);
    state = reducer(state, { type: "reset", id: "fresh", personaId: "M-202", createdAt: "now" });
    expect(state.threads).toHaveLength(1);
    expect(currentThread(state).personaId).toBe("M-202");
  });

  it("drops empty threads when starting a new chat", () => {
    let state = initialState("t0", "M-101", "now");
    state = reducer(state, { type: "thread.new", id: "t1", personaId: "M-101", createdAt: "now" });
    expect(state.threads.map((thread) => thread.id)).toEqual(["t1"]);
  });

  it("caps turns per thread", () => {
    let state = initialState("t0", "M-101", "now");
    for (let index = 0; index < MAX_TURNS + 5; index += 1) {
      state = reducer(state, { type: "turn.start", turn: turn(`n${index}`) });
    }
    expect(currentThread(state).turns).toHaveLength(MAX_TURNS);
  });

  it("tracks approval lifecycle and failures", () => {
    let state = initialState("t0", "M-101", "now");
    state = reducer(state, { type: "turn.start", turn: turn("a", { approval: "pending" }) });
    state = reducer(state, { type: "approval.resolving", turnId: "a" });
    expect(currentThread(state).turns[0].approval).toBe("resolving");
    state = reducer(state, { type: "approval.failed", turnId: "a" });
    expect(currentThread(state).turns[0].approval).toBe("pending");
    state = reducer(state, {
      type: "approval.resolved",
      turnId: "a",
      decision: "reject",
      result: { ...governedApproval, status: "deny" },
    });
    expect(currentThread(state).turns[0]).toMatchObject({ approval: "rejected" });
    state = reducer(state, {
      type: "turn.fail",
      turnId: "a",
      status: "rate_limited",
      retryAfter: 9,
    });
    expect(currentThread(state).turns[0]).toMatchObject({ status: "rate_limited", retryAfter: 9 });
  });

  it("round-trips storage and marks interrupted streams as stalled", () => {
    let state = initialState("t0", "M-101", "now");
    state = reducer(state, { type: "turn.start", turn: turn("a") });
    saveState(localStorage, state);
    const loaded = loadState(localStorage, initialState("other", "M-101", "now"));
    expect(currentThread(loaded).turns[0].status).toBe("stalled");
    localStorage.setItem("bm.threads.v1", "{broken");
    const fallback = initialState("fb", "M-101", "now");
    expect(loadState(localStorage, fallback)).toBe(fallback);
    localStorage.setItem(
      "bm.threads.v1",
      JSON.stringify({ threads: state.threads, currentId: "gone" }),
    );
    expect(loadState(localStorage, fallback).currentId).toBe("t0");
  });
});
