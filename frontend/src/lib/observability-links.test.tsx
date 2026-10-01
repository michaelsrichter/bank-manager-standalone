import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewIds } from "../demo/ReviewIds";
import type { Turn } from "../demo/state";
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
} from "./observability-links";
import type { ObservabilityConfig } from "./types";

const config: ObservabilityConfig = {
  portalOrigin: "https://portal.azure.com",
  tenantId: "00000000-0000-0000-0000-000000000001",
  appInsightsResourceId:
    "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-demo/providers/microsoft.insights/components/appi-demo",
  answerReviewWorkbookId:
    "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-demo/providers/microsoft.insights/workbooks/00000000-0000-0000-0000-000000000003",
  overviewWorkbookId:
    "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-demo/providers/microsoft.insights/workbooks/00000000-0000-0000-0000-000000000004",
};
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const conversationId = "3f2c7b1e-9a4d-4c8e-b5f0-2d6e8a1c4b7f";

describe("review IDs", () => {
  it("accepts only real recorded IDs, so nothing can break out of a query", () => {
    expect(isTraceId(traceId)).toBe(true);
    expect(isTraceId("0".repeat(32))).toBe(false);
    expect(isTraceId("replay-1234")).toBe(false);
    expect(isTraceId(`${traceId}" or true`)).toBe(false);
    expect(isConversationId(conversationId)).toBe(true);
    expect(isConversationId("conv_0a1b2c3d4e5f6a7b8c9dExampleOnly")).toBe(true);
    for (const bad of ['x" | take 1', "a b c d e f g h", "conv_'1'", "conv\\1234567", ""]) {
      expect(isConversationId(bad), bad).toBe(false);
      expect(() => conversationKql(bad)).toThrow();
    }
    expect(() => answerStepsKql("not-a-trace")).toThrow();
  });

  it("puts the ID into the query as a plain string", () => {
    expect(answerStepsKql(traceId)).toContain(`let traceId = "${traceId}";`);
    expect(conversationKql("conv_12345678")).toContain('let conversationId = "conv_12345678";');
    expect(conversationKql("conv_12345678")).toContain("gen_ai.conversation.id");
  });

  it("builds portal links only for the configured resources", async () => {
    expect(appInsightsLogsUrl(config)).toBe(
      `https://portal.azure.com/#@${config.tenantId}/resource${config.appInsightsResourceId}/logs`,
    );
    expect(answerReviewWorkbookUrl(config)).toBe(
      `https://portal.azure.com/#@${config.tenantId}/resource${config.answerReviewWorkbookId}/workbook`,
    );
    expect(overviewWorkbookUrl(config)).toContain("00000000-0000-0000-0000-000000000004/workbook");
    expect(answerReviewWorkbookUrl({ ...config, answerReviewWorkbookId: null })).toBeNull();
    expect(overviewWorkbookUrl({ ...config, overviewWorkbookId: undefined })).toBeNull();
    expect(() =>
      appInsightsLogsUrl({ ...config, portalOrigin: "http://portal.azure.com" }),
    ).toThrow();
    expect(() => appInsightsLogsUrl({ ...config, tenantId: "evil" })).toThrow();
    expect(() =>
      appInsightsLogsUrl({ ...config, appInsightsResourceId: "https://evil.example" }),
    ).toThrow();

    expect(windowAround([undefined])).toBeNull();
    const window = windowAround(["2026-10-01T01:36:15.000Z"]);
    expect(window).toEqual({ from: "2026-10-01T00:36:15.000Z", to: "2026-10-01T02:36:15.000Z" });
    const link = await logsQueryUrl(config, answerStepsKql(traceId), window);
    expect(
      link.startsWith(
        `https://portal.azure.com/#@${config.tenantId}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/`,
      ),
    ).toBe(true);
    expect(link).toContain(encodeURIComponent("2026-10-01T00:36:15.000Z/2026-10-01T02:36:15.000Z"));
    expect(await logsQueryUrl(config, "x", null)).toContain("/timespan/P1D");

    // The q segment is base64(gzip(query)) and decodes back to the exact KQL.
    const encoded = decodeURIComponent(link.split("/q/")[1].split("/timespan/")[0]);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const text = await new Response(
      new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(text).toBe(answerStepsKql(traceId));
  });
});

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "t1",
    prompt: "Show my accounts",
    personaId: "M-101",
    modelKey: "m",
    modelLabel: "Model",
    policyState: { restrictedMode: false, customerApproved: false, adminMode: false },
    status: "done",
    steps: [],
    traceId,
    conversationId,
    responseModel: "gpt-4.1-mini",
    answeredAt: "2026-10-01T01:36:15.000Z",
    ...overrides,
  } as Turn;
}

describe("ReviewIds panel", () => {
  it("is closed by default and lists IDs, links and both queries", async () => {
    const user = userEvent.setup();
    render(<ReviewIds turn={makeTurn({ approvalTraceId: "a".repeat(32) })} config={config} />);
    const details = screen.getByText("IDs and observability links").closest("details")!;
    expect(details.open).toBe(false);
    await user.click(screen.getByText("IDs and observability links"));
    expect(screen.getByText(traceId)).toBeInTheDocument();
    expect(screen.getByText(conversationId)).toBeInTheDocument();
    expect(screen.getByText("Approval decision trace ID")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Answer review workbook" })).toHaveAttribute(
      "href",
      answerReviewWorkbookUrl(config)!,
    );
    expect(screen.getByRole("link", { name: "Demo overview workbook" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Application Insights Logs" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "This answer in Logs" })).toBeInTheDocument();
    expect(screen.getByText("Query: the whole chat as one row")).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy Trace ID" }));
    expect(writeText).toHaveBeenCalledWith(traceId);
    expect(await screen.findAllByText("Copied")).not.toHaveLength(0);
  });

  it("falls back to the older copy command when the clipboard is blocked", async () => {
    const user = userEvent.setup();
    render(<ReviewIds turn={makeTurn()} config={config} />);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      configurable: true,
    });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    await user.click(screen.getByText("IDs and observability links"));
    await user.click(screen.getByRole("button", { name: "Copy Conversation ID" }));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Copy blocked")).toBeInTheDocument();
  });

  it("gives practice answers no links", () => {
    render(<ReviewIds turn={makeTurn({ practice: true })} config={config} />);
    expect(screen.getByText(/Practice answers do not use the AI model/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says when monitoring links are not set up", () => {
    render(<ReviewIds turn={makeTurn()} config={null} />);
    expect(screen.getByText(/not set up for this deployment/)).toBeInTheDocument();
  });

  it("renders nothing without IDs", () => {
    const { container } = render(
      <ReviewIds turn={makeTurn({ traceId: undefined, conversationId: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
