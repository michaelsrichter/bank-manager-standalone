import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  RateLimitedError,
  StreamStalledError,
  getConfig,
  getHealth,
  resolveApproval,
  sendClientTiming,
  sendPageView,
  streamCompare,
} from "./api";
import { daysSince, formatDate, formatTime, formatUsd, shortSha } from "./format";
import { loadConsent, loadTheme, saveConsent, saveTheme } from "./preferences";
import { loadProfile, makeProfile, resetProfile } from "./profile";
import { parseHash } from "./router";
import type { StreamEvent } from "./types";

function ndjsonResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const body = {
  prompt: "Show account A-1001",
  personaId: "M-101",
  modelKey: "gpt-4.1",
  policyState: { restrictedMode: false, customerApproved: false, adminMode: false },
};

describe("streamCompare", () => {
  it("delivers ordered events across chunk boundaries and drops duplicates", async () => {
    const lines = [
      '{"seq":1,"type":"run.started","traceId":"t","model":{"key":"k","label":"L","deployment":"d"}}\n{"seq":2,"type":"st',
      'ep","id":"route","state":"started"}\n{"seq":2,"type":"step","id":"dup","state":"x"}\n',
      '{"seq":3,"type":"run.completed","traceId":"t"}',
    ];
    const fetcher = vi.fn().mockResolvedValue(ndjsonResponse(lines));
    const events: StreamEvent[] = [];
    await streamCompare(body, "session", (event) => events.push(event), { fetcher });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    const [, init] = fetcher.mock.calls[0];
    expect(init.headers["X-Demo-Session"]).toBe("session");
    expect(init.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("raises a rate-limit error with the server's retry hint", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "12" } }));
    await expect(streamCompare(body, "s", () => undefined, { fetcher })).rejects.toMatchObject({
      retryAfterSeconds: 12,
    });
  });

  it("raises an API error with the server message", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":"invalid_prompt","message":"Too long"}', { status: 400 }),
      );
    const error = await streamCompare(body, "s", () => undefined, { fetcher }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Too long");
  });

  it("aborts with a stall error when events stop arriving", async () => {
    const stalled = new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    const fetcher = vi.fn().mockResolvedValue(stalled);
    await expect(
      streamCompare(body, "s", () => undefined, { fetcher, stallMs: 10 }),
    ).rejects.toBeInstanceOf(StreamStalledError);
  });
});

describe("api helpers", () => {
  it("loads config and health, including a not-ready 503", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"defaultModel":"gpt-4.1"}'))
      .mockResolvedValueOnce(new Response('{"status":"not_ready"}', { status: 503 }))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect((await getConfig(fetcher)).defaultModel).toBe("gpt-4.1");
    expect((await getHealth(fetcher)).status).toBe("not_ready");
    await expect(getHealth(fetcher)).rejects.toBeInstanceOf(ApiError);
  });

  it("posts approvals and page views", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"result":{"status":"allow"},"traceId":"t"}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await resolveApproval(
      {
        action: { tool_name: "read_account", args: { account_id: "A-1001" } },
        personaId: "M-101",
        policyState: body.policyState,
        decision: "approve",
      },
      "s",
      fetcher,
    );
    expect(response.result.status).toBe("allow");
    sendPageView("demo", fetcher);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ page: "demo" });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    sendClientTiming(
      { firstEventMs: 1, totalMs: 2, eventCount: 3, outcome: "done", modelKey: "gpt-4.1" },
      fetcher,
    );
    expect(fetcher.mock.calls[2][0]).toBe("/api/telemetry/client-timing");
  });

  it("maps 429 on approval to RateLimitedError", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(
      resolveApproval(
        {
          action: { tool_name: "x", args: {} },
          personaId: "M",
          policyState: body.policyState,
          decision: "reject",
        },
        "s",
        fetcher,
      ),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("profile", () => {
  it("creates an alias and GUID and persists it", () => {
    const profile = makeProfile(
      () => 0,
      () => "00000000-0000-4000-8000-000000000000",
    );
    expect(profile.alias).toBe("Curious Otter 1000");
    const loaded = loadProfile();
    expect(loadProfile()).toEqual(loaded);
    expect(resetProfile().id).not.toBe(loaded.id);
  });

  it("recovers from corrupt storage", () => {
    localStorage.setItem("bm.profile.v1", "{bad");
    expect(loadProfile().id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("formatting and routing", () => {
  it("formats money, dates, and commits safely", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000923)).toBe("$0.000923");
    expect(formatUsd(1.5)).toBe("$1.5000");
    expect(daysSince("2026-01-01T00:00:00Z", new Date("2026-01-04T12:00:00Z"))).toBe(3);
    expect(daysSince("not a date")).toBe(0);
    expect(shortSha("abcdef1234567")).toBe("abcdef1");
    expect(shortSha("unknown")).toBe("unknown");
    expect(formatDate("2026-09-29T10:00:00Z")).toBe("2026-09-29");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("nope")).toBe("—");
    expect(formatTime(null)).toBe("—");
    expect(formatTime(0)).not.toBe("—");
  });

  it("parses hash routes", () => {
    expect(parseHash("")).toEqual({ page: "home" });
    expect(parseHash("#/demo")).toEqual({ page: "demo" });
    expect(parseHash("#/docs/security/auth.md")).toEqual({ page: "docs", doc: "security/auth.md" });
    expect(parseHash("#/docs")).toEqual({ page: "docs", doc: "README.md" });
    expect(parseHash("#/unknown")).toEqual({ page: "home" });
  });

  it("stores consent and theme preferences", () => {
    expect(loadConsent()).toBeNull();
    saveConsent("necessary");
    expect(loadConsent()).toBe("necessary");
    expect(loadTheme(localStorage, true)).toBe("dark");
    saveTheme("light");
    expect(loadTheme(localStorage, true)).toBe("light");
  });
});
