import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import QRCode from "qrcode";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicDemoUrl, repoUrl } from "./constants";
import { sessionDeck, totalMinutes } from "./deck";
import { slideSnippet, slideSnippets } from "./snippets";
import DemoWindow from "./DemoWindow";
import PresenterConsole, { outsideLinksForSlide, surfaceLabels } from "./PresenterConsole";
import {
  emptyPresenter,
  eventDateLabel,
  normalizePresenterUrl,
  presenterQrLabel,
  validEventDate,
} from "./presenter-details";
import { PresenterDetailsButton } from "./PresenterDetailsDialog";
import { ScriptPage } from "./ScriptPage";
import { SlideFrame } from "./SlideFrame";
import { SlidesPage } from "./SlidesPage";
import {
  appScreenFor,
  appScreens,
  applyCommand,
  commandForKey,
  parseShowMessage,
  type ShowState,
} from "./show-sync";

const baseState: ShowState = {
  slide: 0,
  mode: { kind: "slide" },
  presenter: emptyPresenter,
  theme: "dark",
};

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    set.add(this);
    FakeBroadcastChannel.channels.set(name, set);
  }
  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) window.setTimeout(() => peer.onmessage?.({ data } as MessageEvent), 0);
    }
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
function renderSlide(index: number) {
  return (
    <SlideFrame
      deck={sessionDeck}
      slide={sessionDeck.slides[index]}
      index={index}
      presenter={emptyPresenter}
    />
  );
}
function renderQr() {
  return <div>QR screen</div>;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.channels.clear();
});

describe("presentation content", () => {
  it("has unique slides, notes, timing, safe launch links, and matching source code", () => {
    expect(new Set(sessionDeck.slides.map((slide) => slide.id)).size).toBe(
      sessionDeck.slides.length,
    );
    expect(totalMinutes(sessionDeck)).toBeGreaterThanOrEqual(sessionDeck.targetMinutes * 0.85);
    expect(totalMinutes(sessionDeck)).toBeLessThanOrEqual(sessionDeck.targetMinutes);
    const allowed = new Set<string>(appScreens.map((screen) => screen.path));
    for (const slide of sessionDeck.slides) {
      expect(slide.notes.say.length, slide.id).toBeGreaterThan(0);
      expect(slide.notes.minutes, slide.id).toBeGreaterThan(0);
      if (slide.notes.surface === "app")
        expect(slide.notes.fallback?.join(" ")).toContain("Practice");
      for (const block of slide.blocks) {
        if (block.kind === "launch")
          for (const link of block.links)
            expect(link.href.startsWith("https://") || allowed.has(link.href), link.href).toBe(
              true,
            );
        if (block.kind === "snippet")
          for (const item of block.items) {
            const snippet = slideSnippets[item.id];
            expect(snippet, item.id).toBeDefined();
            expect(snippet.href.startsWith(`${repoUrl}/blob/main/${snippet.file}#L`)).toBe(true);
            expect(existsSync(`../${snippet.file}`), snippet.file).toBe(true);
          }
        if (block.kind === "code" && block.source) {
          const source = normalize(readFileSync(`../${block.source}`, "utf8"));
          // "# ..." lines mark skipped rules; every other line must appear, in order.
          let from = 0;
          for (const line of block.code.split("\n").filter((l) => !l.startsWith("# ..."))) {
            const at = source.indexOf(normalize(line), from);
            expect(at, line).toBeGreaterThanOrEqual(0);
            from = at;
          }
          expect(block.code).not.toContain("tour:");
        }
      }
    }
  });

  it("renders real source snippets with GitHub line links, and the three-checks flow", () => {
    const at = (id: string) => sessionDeck.slides.findIndex((slide) => slide.id === id);
    const { rerender } = render(
      <SlideFrame
        deck={sessionDeck}
        slide={sessionDeck.slides[at("acs-run-tool")]}
        index={at("acs-run-tool")}
        presenter={emptyPresenter}
      />,
    );
    const link = screen.getByRole("link", {
      name: /GitHub · backend\/bank_manager\/bank\/governance\.py/,
    });
    expect(link).toHaveAttribute("href", slideSnippet("slide-acs-run-tool").href);
    expect(document.querySelector(".slide-snippet code.hljs")?.textContent).toContain("run_tool");
    expect(() => slideSnippet("slide-missing")).toThrow("tour:begin slide-missing");
    rerender(
      <SlideFrame
        deck={sessionDeck}
        slide={sessionDeck.slides[at("three-checks")]}
        index={at("three-checks")}
        presenter={emptyPresenter}
      />,
    );
    expect(screen.getByRole("list", { name: /three ACS checks/ })).toBeInTheDocument();
    expect(screen.getByText("② pre_tool_call")).toBeInTheDocument();
    expect(document.querySelector(".flow-check code, .flow-step code")?.textContent).toBe(
      "prepare_transfer",
    );
  });

  it("keeps the committed demo QR code in sync with the configured address", async () => {
    const expected = await QRCode.toString(publicDemoUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#231f20ff", light: "#ffffffff" },
    });
    const actual = readFileSync("public/presentation/demo-qr.svg", "utf8");
    expect(actual).toBe(expected);
  });
});

describe("presenter details", () => {
  it("accepts only https links (upgrading http) and real dates, and labels known sites", () => {
    expect(normalizePresenterUrl("example.com/me")).toBe("https://example.com/me");
    expect(normalizePresenterUrl("http://example.com")).toBe("https://example.com/");
    expect(normalizePresenterUrl("ftp://example.com")).toBeNull();
    expect(normalizePresenterUrl("https://user:pw@example.com")).toBeNull();
    expect(presenterQrLabel({ qrLabel: "", qrUrl: "linkedin.com/in/ada" })).toBe("LinkedIn");
    expect(presenterQrLabel({ qrLabel: "", qrUrl: "https://www.example.org/x" })).toBe(
      "example.org",
    );
    expect(presenterQrLabel({ qrLabel: "My site", qrUrl: "https://github.com/ada" })).toBe(
      "My site",
    );
    expect(presenterQrLabel({ qrLabel: "", qrUrl: "" })).toBe("Presenter link");
    expect(validEventDate("2026-11-05")).toBe("2026-11-05");
    expect(validEventDate("2026-02-30")).toBe("");
    expect(eventDateLabel({ eventDate: "2026-11-05" })).toBe("November 5, 2026");
  });

  it("previews the QR code while typing, saves sanitized details, and rejects unsafe links", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<PresenterDetailsButton presenter={emptyPresenter} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Presenter details" }));
    await user.type(screen.getByLabelText("Name"), "  Ada   Lovelace  ");
    const link = screen.getByLabelText("Your link for a QR code");
    await user.type(link, "javascript:alert(1)");
    expect(screen.getByText(/can't become a QR code yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByRole("alert")).toHaveTextContent("https://");
    await user.clear(link);
    await user.type(link, "http://www.linkedin.com/in/ada");
    const preview = await screen.findByAltText(/Preview of your QR code/);
    expect(preview.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole("link", { name: "Download QR code (SVG)" })).toHaveAttribute(
      "download",
      "presenter-qr.svg",
    );
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada Lovelace",
        qrUrl: "https://www.linkedin.com/in/ada",
      }),
    );
  });
});

describe("slides and script pages", () => {
  it("handles keys, hash links, notes, and ignores keys typed in fields", async () => {
    window.history.pushState(null, "", "/presentation/session#ms-stack");
    const user = userEvent.setup();
    render(<SlidesPage deck={sessionDeck} presenter={emptyPresenter} onSavePresenter={vi.fn()} />);
    expect(screen.getByText(/3 \/ 27: Microsoft stack/)).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(window.location.hash).toBe("#stack");
    await user.keyboard("n");
    expect(screen.getByLabelText("Speaker notes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Presenter details" }));
    await user.type(screen.getByLabelText("Name"), "x{ArrowRight}");
    expect(window.location.hash).toBe("#stack");
  });

  it("renders the printable script and presenter details on title slide", () => {
    const presenter = {
      ...emptyPresenter,
      name: "Ada",
      role: "Architect",
      eventName: "Partner session",
      eventDate: "2026-10-01",
    };
    const { rerender } = render(
      <ScriptPage deck={sessionDeck} presenter={presenter} onSavePresenter={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Get ready" })).toBeInTheDocument();
    expect(screen.getAllByText(/Show account A-1001/).length).toBeGreaterThan(0);
    rerender(
      <SlideFrame
        deck={sessionDeck}
        slide={sessionDeck.slides[0]}
        index={0}
        presenter={presenter}
      />,
    );
    expect(screen.getByText("Partner session")).toBeInTheDocument();
    expect(screen.getByText("Ada · Architect")).toBeInTheDocument();
  });
});

describe("two-screen mode", () => {
  it("accepts only known messages, real slides, and allow-listed site pages", () => {
    const state = { kind: "state", source: "console", state: { ...baseState, slide: 3 } };
    expect(parseShowMessage(state, sessionDeck.slides.length)).toEqual(state);
    expect(
      parseShowMessage({ ...state, state: { ...baseState, slide: 99 } }, sessionDeck.slides.length),
    ).toBeNull();
    for (const path of ["/#/admin", "/demo", "https://example.com", "javascript:alert(1)"]) {
      expect(
        parseShowMessage(
          { ...state, state: { ...baseState, mode: { kind: "app", path } } },
          sessionDeck.slides.length,
        ),
        path,
      ).toBeNull();
    }
    expect(appScreenFor("/#/demo?mode=practice")?.label).toBe("Practice backup");
    expect(commandForKey("PageDown")).toBe("next");
    expect(applyCommand({ ...baseState, slide: 19 }, "next", 20).slide).toBe(19);
  });

  it("syncs console state to the Demo Window and keeps app frames mounted", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onThemeChange = vi.fn();
    const both = (theme: "dark" | "light") => (
      <>
        <PresenterConsole
          deck={sessionDeck}
          presenter={emptyPresenter}
          theme={theme}
          renderSlide={renderSlide}
          renderQr={renderQr}
          observability={null}
        />
        <DemoWindow
          deck={sessionDeck}
          renderSlide={renderSlide}
          renderQr={renderQr}
          onThemeChange={onThemeChange}
        />
      </>
    );
    const view = render(both("dark"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Demo Window connected"),
    );
    await waitFor(() => expect(onThemeChange).toHaveBeenLastCalledWith("dark"));
    // The site theme follows the console, so the framed live pages match the slides.
    view.rerender(both("light"));
    await waitFor(() => expect(onThemeChange).toHaveBeenLastCalledWith("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: /^5 Meet demo/ }));
    await userEvent.click(screen.getByRole("button", { name: /Show Live demo/ }));
    await waitFor(() => expect(screen.getByTitle("Live demo (live site)")).toBeInTheDocument());
    expect(screen.getByTitle("Live demo (live site)")).toHaveAttribute("src", "/#/demo");
    await userEvent.click(screen.getByRole("button", { name: "Slide (S)" }));
    expect(screen.getByTitle("Live demo (live site)")).toHaveAttribute("hidden");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    await waitFor(() => expect(window.location.hash).toBe("#evaluators"));
  });

  it("offers portal links in their own window on the evidence slide", () => {
    const evidence = sessionDeck.slides.find((slide) => slide.notes.surface === "observability")!;
    const config = {
      portalOrigin: "https://portal.azure.com",
      tenantId: "00000000-0000-0000-0000-000000000001",
      appInsightsResourceId:
        "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg/providers/microsoft.insights/components/appi",
      answerReviewWorkbookId:
        "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg/providers/microsoft.insights/workbooks/00000000-0000-0000-0000-000000000003",
    };
    const labels = outsideLinksForSlide(evidence, config).map((link) => link.label);
    expect(labels).toEqual(["Answer review workbook", "Application Insights Logs"]);
    expect(outsideLinksForSlide(evidence, null)).toEqual([]);
    expect(outsideLinksForSlide(sessionDeck.slides[0], config)).toEqual([]);
    expect(surfaceLabels.observability).toBe("Azure Monitor");
  });

  it("reports blocked pop-ups", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <PresenterConsole
        deck={sessionDeck}
        presenter={emptyPresenter}
        theme="dark"
        renderSlide={renderSlide}
        renderQr={renderQr}
        observability={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open Demo Window" }));
    expect(screen.getByRole("alert")).toHaveTextContent("blocked");
  });
});
