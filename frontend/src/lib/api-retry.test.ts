import { describe, expect, it, vi } from "vitest";
import { withNetworkRetry } from "./api";

const ok = () => new Response("ok", { status: 200 });

describe("withNetworkRetry", () => {
  it("retries dropped connections, then returns the response", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    const response = await withNetworkRetry(fetcher, [0, 0, 0])("/api/config");
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("returns HTTP errors without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    const response = await withNetworkRetry(fetcher, [0, 0])("/api/health");
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last retry and never retries an abort", async () => {
    const dropped = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(withNetworkRetry(dropped, [0, 0])("/api/compare")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(dropped).toHaveBeenCalledTimes(3);

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(
      withNetworkRetry(aborted, [0, 0])("/api/compare", { signal: controller.signal }),
    ).rejects.toThrow("aborted");
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
