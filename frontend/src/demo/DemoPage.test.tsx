import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RateLimitedError, StreamStalledError } from "../lib/api";
import type { AppConfig, LaneResult, StreamEvent } from "../lib/types";
import { DemoPage } from "./DemoPage";

const config: AppConfig = {
  models: [
    {
      key: "gpt-4.1",
      label: "GPT-4.1",
      deployment: "gpt-4.1",
      model: "gpt-4.1",
      pricing: {
        currency: "USD",
        inputPer1MTokens: 2,
        cachedInputPer1MTokens: 0.5,
        outputPer1MTokens: 8,
        source: "x",
      },
    },
    {
      key: "gpt-4.1-mini",
      label: "GPT-4.1 mini",
      deployment: "gpt-4.1-mini",
      model: "gpt-4.1-mini",
      pricing: {
        currency: "USD",
        inputPer1MTokens: 0.4,
        cachedInputPer1MTokens: 0.1,
        outputPer1MTokens: 1.6,
        source: "x",
      },
    },
  ],
  defaultModel: "gpt-4.1",
  personas: [
    {
      id: "M-101",
      label: "Riley (branch manager)",
      role: "bank_manager",
      assignedAccounts: ["A-1001"],
    },
    {
      id: "M-202",
      label: "Sam (senior manager)",
      role: "senior_manager",
      assignedAccounts: ["A-2001"],
    },
  ],
  defaultPersona: "M-101",
  scenarios: [{ prompt: "Prepare transfer $12,000 from A-1001 to A-2001", expect: "Paused." }],
  limits: { maxPromptChars: 500, perSessionPerMinute: 10 },
  fakeAi: false,
  repoUrl: "https://github.com/x/y",
};

const baseline: LaneResult = {
  lane: "baseline",
  status: "allow",
  reason: "baseline_no_policy",
  message: "",
  text: "Prepared transfer of $12,000.00",
  toolExecuted: true,
  interventionPoint: null,
  policyDecision: "not_evaluated",
  action: { tool_name: "prepare_transfer", args: { account_id: "A-1001", amount: 12000 } },
};

const governed: LaneResult = {
  ...baseline,
  lane: "governed",
  status: "approval",
  reason: "high_value_transfer_requires_approval",
  message: "Transfers over $10,000 require senior approval.",
  text: null,
  toolExecuted: false,
  interventionPoint: "pre_tool_call",
  policyDecision: "approval",
};

const events: StreamEvent[] = [
  {
    seq: 1,
    type: "run.started",
    traceId: "abc123",
    model: { key: "gpt-4.1", label: "GPT-4.1", deployment: "gpt-4.1" },
  },
  { seq: 2, type: "step", id: "route", state: "started" },
  { seq: 3, type: "step", id: "route", state: "completed" },
  {
    seq: 4,
    type: "model.usage",
    requestedDeployment: "gpt-4.1",
    responseModel: "gpt-4.1-2025-04-14",
    usage: { inputTokens: 320, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 0 },
    cost: { currency: "USD", totalUsd: 0.00088, confidence: "estimate" },
    durationMs: 700,
    fakeAi: false,
  },
  { seq: 5, type: "tool.selected", action: baseline.action },
  { seq: 6, type: "lane.result", result: baseline },
  { seq: 7, type: "step", id: "governed.pre_tool", state: "completed", status: "approval" },
  { seq: 8, type: "lane.result", result: governed },
  { seq: 9, type: "run.completed", traceId: "abc123" },
];

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    streamCompare: vi.fn(async (_body, _session, onEvent: (event: StreamEvent) => void) => {
      events.forEach(onEvent);
    }),
    resolveApproval: vi.fn().mockResolvedValue({
      result: {
        ...governed,
        status: "allow",
        toolExecuted: true,
        text: "Prepared transfer of $12,000.00 (approved)",
      },
      traceId: "t2",
    }),
    ...overrides,
  };
}

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

describe("DemoPage", () => {
  it("streams a comparison, shows evidence, and resolves an approval", async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<DemoPage api={api as never} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: /Prepare transfer \$12,000/ }));

    expect(await screen.findByText("Prepared transfer of $12,000.00")).toBeInTheDocument();
    expect(
      screen.getByText(/prepare_transfer\(account_id=A-1001, amount=12000\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1-2025-04-14")).toBeInTheDocument();
    expect(screen.getByText("320 / 0 / 30 / 0")).toBeInTheDocument();
    expect(screen.getByText(/\$0\.000880 \(estimate\)/)).toBeInTheDocument();
    expect(
      screen.getByText("A person must approve this step.", { selector: "p" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("Prepared transfer of $12,000.00 (approved)"),
    ).toBeInTheDocument();
    expect(api.resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "approve", personaId: "M-101" }),
      expect.any(String),
    );
  });

  it("sends the chosen model and typed prompt", async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<DemoPage api={api as never} newId={newId} />);
    await user.selectOptions(
      await screen.findByLabelText("AI model that picks the tool"),
      "gpt-4.1-mini",
    );
    await user.type(screen.getByLabelText("Your request"), "Show account A-1001");
    await user.click(screen.getByRole("button", { name: "Run comparison" }));
    await waitFor(() => expect(api.streamCompare).toHaveBeenCalled());
    expect(api.streamCompare.mock.calls[0][0]).toMatchObject({
      prompt: "Show account A-1001",
      modelKey: "gpt-4.1-mini",
    });
  });

  it("shows designed rate-limit, stall, and failure states", async () => {
    const failures = [new RateLimitedError(7), new StreamStalledError(), new Error("boom")];
    const api = makeApi({
      streamCompare: vi.fn(async () => {
        throw failures.shift();
      }),
    });
    const user = userEvent.setup();
    render(<DemoPage api={api as never} newId={newId} />);
    const input = await screen.findByLabelText("Your request");
    for (const prompt of ["one", "two", "three"]) {
      await user.type(input, prompt);
      await user.click(screen.getByRole("button", { name: "Run comparison" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Run comparison" })).toBeDisabled(),
      );
    }
    expect(await screen.findByText(/Try again in 7 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/response stopped arriving/)).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("starts a new chat when the persona changes and keeps history, then resets", async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<DemoPage api={api as never} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: /Prepare transfer \$12,000/ }));
    await screen.findByText("Prepared transfer of $12,000.00");
    await user.selectOptions(screen.getByLabelText("You are signed in as"), "M-202");
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.getByText("Earlier chats (1)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open: “Prepare transfer/ }));
    expect(screen.getByText("Prepared transfer of $12,000.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear current chat" }));
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(screen.getByText("Earlier chats (0)")).toBeInTheDocument();
  });

  it("resets the anonymous profile", async () => {
    const user = userEvent.setup();
    render(<DemoPage api={makeApi() as never} newId={newId} />);
    const profile = screen.getByText(/^Your anonymous nickname/).querySelector("strong")!;
    const before = profile.textContent;
    let after = before;
    for (let attempt = 0; attempt < 5 && after === before; attempt += 1) {
      await user.click(screen.getByRole("button", { name: "Reset profile" }));
      after = screen.getByText(/^Your anonymous nickname/).querySelector("strong")!.textContent;
    }
    expect(after).not.toBe(before);
  });

  it("shows a designed error when config cannot load", async () => {
    render(
      <DemoPage api={makeApi({ getConfig: vi.fn().mockRejectedValue(new Error("x")) }) as never} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the demo settings");
  });

  it("restores approval buttons when a decision fails", async () => {
    const api = makeApi({ resolveApproval: vi.fn().mockRejectedValue(new Error("down")) });
    const user = userEvent.setup();
    render(<DemoPage api={api as never} newId={newId} />);
    await user.click(await screen.findByRole("button", { name: /Prepare transfer \$12,000/ }));
    const governedLane = await screen.findByRole("region", { name: "Governed by policy" });
    await act(async () => {
      await user.click(within(governedLane).getByRole("button", { name: "Reject" }));
    });
    expect(within(governedLane).getByRole("button", { name: "Reject" })).toBeEnabled();
  });
});
