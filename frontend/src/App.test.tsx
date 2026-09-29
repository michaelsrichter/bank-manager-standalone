import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { Footer } from "./components/Footer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DocsPage } from "./pages/DocsPage";
import { HealthPage } from "./pages/HealthPage";

describe("App shell", () => {
  it("shows the demo-only badge, cookie banner, and toggles theme", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByText("For demo purposes only").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("move money");

    await user.click(screen.getByRole("button", { name: "Allow anonymous analytics" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/telemetry/page-view", expect.anything()),
    );

    const toggle = screen.getByRole("button", { name: /Switch to (dark|light) mode/ });
    const before = document.documentElement.dataset.theme;
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).not.toBe(before);
    vi.unstubAllGlobals();
  });

  it("does not send analytics when only necessary storage is allowed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Only necessary storage" }));
    window.location.hash = "#/privacy";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { name: "Privacy notice" })).toBeInTheDocument();
    window.location.hash = "#/terms";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText(/Not an official Microsoft product/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("opens and closes the mobile menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("link", { name: "Health" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Footer", () => {
  it("renders a build-time colophon with commit link and age", () => {
    render(
      <Footer
        info={{ sha: "abcdef1234567890", date: "2026-09-20T00:00:00Z", message: "Add governance" }}
        now={new Date("2026-09-29T00:00:00Z")}
      />,
    );
    const colophon = screen.getByTestId("colophon");
    expect(colophon).toHaveTextContent("2026-09-20");
    expect(colophon).toHaveTextContent("Add governance");
    expect(colophon).toHaveTextContent("9 days ago");
    expect(screen.getByRole("link", { name: "abcdef1" })).toHaveAttribute(
      "href",
      expect.stringContaining("/commit/abcdef1234567890"),
    );
    expect(
      screen.getByText("Built by Mike Richter and Thomas Mathew at Microsoft."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /LinkedIn/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toBeInTheDocument();
  });

  it("handles unknown build metadata", () => {
    render(<Footer info={{ sha: "unknown", date: "x", message: "unknown" }} />);
    expect(screen.getByTestId("colophon")).toHaveTextContent("today");
  });
});

describe("HealthPage", () => {
  it("renders nullable health data safely", async () => {
    const load = vi.fn().mockResolvedValue({
      status: "ready",
      checkedAt: null,
      components: [
        {
          name: "ACS policy engine",
          status: "healthy",
          detail: "Expected denial proven",
          critical: true,
        },
        null,
        { name: null, status: null, detail: null },
      ],
    });
    render(<HealthPage load={load} />);
    expect(await screen.findByText("Expected denial proven")).toBeInTheDocument();
    expect(screen.getByText("ACS policy engine *")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(1);
  });

  it("shows an error state and pauses while hidden", async () => {
    const load = vi.fn().mockRejectedValue(new Error("down"));
    render(<HealthPage load={load} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load health");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe("DocsPage", () => {
  it("renders build-time docs and a not-found state", () => {
    const pages = { "README.md": { title: "Docs", html: "<h1>Documentation home</h1>" } };
    const { rerender } = render(<DocsPage doc="README.md" pages={pages} />);
    expect(screen.getByRole("heading", { name: "Documentation home" })).toBeInTheDocument();
    rerender(<DocsPage doc="missing.md" pages={pages} />);
    expect(screen.getByRole("alert")).toHaveTextContent("not found");
    rerender(<DocsPage doc="" pages={{ "README.md": pages["README.md"] }} />);
  });

  it("serves the real generated docs index", () => {
    render(<DocsPage doc="README.md" />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});

describe("ErrorBoundary", () => {
  it("contains render failures", () => {
    const Broken = () => {
      throw new Error("x");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("hit an error");
    vi.restoreAllMocks();
  });
});
