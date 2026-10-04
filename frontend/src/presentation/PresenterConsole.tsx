import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getConfig } from "../lib/api";
import {
  answerReviewWorkbookUrl,
  appInsightsLogsUrl,
  logsQueryUrl,
  overviewWorkbookUrl,
  recentLanesKql,
} from "../lib/observability-links";
import type { ObservabilityConfig } from "../lib/types";
import {
  formatMinutes,
  paceLabel,
  slideStartTimes,
  totalMinutes,
  type Deck,
  type Slide,
  type Surface,
} from "./deck";
import FitStage from "./FitStage";
import type { Presenter } from "./presenter-details";
import { PresenterDetailsButton } from "./PresenterDetailsDialog";
import { Rich } from "./rich-text";
import {
  appScreenFor,
  appScreens,
  applyCommand,
  heartbeatMs,
  isSupported,
  staleAfterMs,
  useShowChannel,
  type AppScreen,
  type ScreenMode,
  type ShowMessage,
  type ShowState,
} from "./show-sync";

type Props = {
  deck: Deck;
  presenter: Presenter;
  onSavePresenter?: (presenter: Presenter) => void;
  theme: "dark" | "light";
  renderSlide: (index: number, presenter: Presenter) => ReactNode;
  renderQr: (presenter: Presenter) => ReactNode;
  /** Where portal links point. Loaded from /api/config when not given. */
  observability?: ObservabilityConfig | null;
};
type ScreenInfo = { at: number; slide: number; mode: ScreenMode; fullscreen: boolean };
type ScreenArea = { availLeft: number; availTop: number; availWidth: number; availHeight: number };
type ScreenDetails = { screens: ScreenArea[]; currentScreen: ScreenArea };
type OutsideLink = { href: string; label: string };

export const surfaceLabels: Record<Surface, string> = {
  slides: "Slides",
  app: "Live site",
  azure: "Azure portal",
  foundry: "Foundry portal",
  observability: "Azure Monitor",
};

export function appScreenForSlide(slide: Slide): AppScreen | null {
  for (const block of slide.blocks)
    if (block.kind === "launch")
      for (const link of block.links) {
        const screen = appScreenFor(link.href);
        if (screen) return screen;
      }
  return slide.notes.surface === "app" ? appScreens[0] : null;
}

function safeUrl(build: () => string | null): string | null {
  try {
    return build();
  } catch {
    return null;
  }
}

/**
 * Pages that cannot appear inside the Demo Window (portals and outside references).
 * They open in their own clean window instead.
 */
export function outsideLinksForSlide(
  slide: Slide,
  observability?: ObservabilityConfig | null,
): OutsideLink[] {
  const links = new Map<string, string>();
  for (const block of slide.blocks)
    if (block.kind === "launch")
      for (const link of block.links)
        if (/^https:\/\//.test(link.href)) links.set(link.href, link.label);
  if (slide.notes.surface === "observability" && observability) {
    const portal: [string, string | null][] = [
      ["Answer review workbook", safeUrl(() => answerReviewWorkbookUrl(observability))],
      ["Demo overview workbook", safeUrl(() => overviewWorkbookUrl(observability))],
      ["Application Insights Logs", safeUrl(() => appInsightsLogsUrl(observability))],
    ];
    for (const [label, href] of portal) if (href) links.set(href, label);
  }
  return [...links].map(([href, label]) => ({ href, label }));
}

function modeLabel(mode: ScreenMode) {
  if (mode.kind === "slide") return "Slide";
  if (mode.kind === "qr") return "QR code";
  if (mode.kind === "black") return "Paused (black screen)";
  return appScreenFor(mode.path)?.label ?? "Live site";
}
function formatClock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], dialog'))
  );
}

function NotesGroup({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <section className="notes-group">
      <h3>{title}</h3>
      <List>
        {items.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </List>
    </section>
  );
}

export default function PresenterConsole({
  deck,
  presenter,
  onSavePresenter,
  theme,
  renderSlide,
  renderQr,
  observability,
}: Props) {
  const initial = Math.max(
    0,
    deck.slides.findIndex((item) => item.id === decodeURIComponent(window.location.hash.slice(1))),
  );
  const [slide, setSlide] = useState(initial);
  const [mode, setMode] = useState<ScreenMode>({ kind: "slide" });
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadedLinks, setLoadedLinks] = useState<ObservabilityConfig | null>(null);
  const portalConfig = observability === undefined ? loadedLinks : observability;
  const touched = useRef(false);
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  const demoWindow = useRef<Window | null>(null);
  const starts = slideStartTimes(deck);
  const current = deck.slides[slide];
  const next = deck.slides[slide + 1];
  const suggestedApp = appScreenForSlide(current);
  const outsideLinks = outsideLinksForSlide(current, portalConfig);
  const showLanes = current.notes.surface === "observability" && Boolean(portalConfig);
  const [lanesLink, setLanesLink] = useState<string | null>(null);
  useEffect(() => {
    if (!showLanes || !portalConfig || typeof CompressionStream === "undefined") return;
    let active = true;
    // The last 4 hours: covers the whole talk plus rehearsal, newest answer first.
    const to = new Date(Date.now() + 10 * 60_000).toISOString();
    const from = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
    logsQueryUrl(portalConfig, recentLanesKql(), { from, to })
      .then((url) => {
        if (active) setLanesLink(url);
      })
      .catch(() => {
        if (active) setLanesLink(null);
      });
    return () => {
      active = false;
    };
  }, [showLanes, portalConfig]);
  const portalLinks: OutsideLink[] =
    showLanes && lanesLink
      ? [{ href: lanesLink, label: "every answer, both lanes (Logs)" }, ...outsideLinks]
      : outsideLinks;
  const connected = screenInfo !== null && now - screenInfo.at < staleAfterMs;
  const canPlaceOnScreen = "getScreenDetails" in window;
  const stateRef = useRef<ShowState>({ slide, mode, presenter, theme });
  useEffect(() => {
    stateRef.current = { slide, mode, presenter, theme };
  });

  useEffect(() => {
    if (observability !== undefined) return;
    let active = true;
    getConfig()
      .then((config) => {
        if (active) setLoadedLinks(config.observability ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [observability]);

  useEffect(() => {
    document.title = `Presenter console · ${deck.title} | Governed AI Bank Assistant`;
  }, [deck.title]);

  const apply = useCallback((nextState: Pick<ShowState, "slide" | "mode">) => {
    touched.current = true;
    setReady(true);
    setSlide(nextState.slide);
    setMode(nextState.mode);
  }, []);
  const postRef = useRef<(message: ShowMessage) => void>(() => undefined);
  const onMessage = useCallback(
    (message: ShowMessage) => {
      if (message.kind === "hello" && message.source === "screen") {
        if (readyRef.current)
          postRef.current({ kind: "state", source: "console", state: stateRef.current });
      } else if (message.kind === "heartbeat") {
        setScreenInfo({
          at: Date.now(),
          slide: message.slide,
          mode: message.mode,
          fullscreen: message.fullscreen,
        });
        setNow(Date.now());
        if (!touched.current) {
          // A Demo Window is already running (for example, after this page reloaded).
          // Continue from where it is.
          touched.current = true;
          setSlide(message.slide);
          setMode(message.mode);
        }
        setReady(true);
      } else if (message.kind === "command")
        apply(applyCommand(stateRef.current, message.command, deck.slides.length));
    },
    [apply, deck.slides.length],
  );
  const post = useShowChannel(deck.id, deck.slides.length, onMessage);
  useEffect(() => {
    postRef.current = post;
  }, [post]);
  useEffect(() => {
    post({ kind: "hello", source: "console" });
    const wait = window.setTimeout(() => setReady(true), 800);
    return () => window.clearTimeout(wait);
  }, [post]);
  useEffect(() => {
    if (!ready) return;
    post({ kind: "state", source: "console", state: { slide, mode, presenter, theme } });
    window.history.replaceState(null, "", `${window.location.pathname}#${deck.slides[slide].id}`);
  }, [deck, post, ready, slide, mode, presenter, theme]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (readyRef.current) post({ kind: "state", source: "console", state: stateRef.current });
      setNow(Date.now());
    }, heartbeatMs);
    return () => window.clearInterval(interval);
  }, [post]);
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [running]);
  const goTo = useCallback(
    (index: number) =>
      apply({
        slide: Math.min(deck.slides.length - 1, Math.max(0, index)),
        mode: { kind: "slide" },
      }),
    [apply, deck.slides.length],
  );
  const show = useCallback(
    (nextMode: ScreenMode) => apply({ slide: stateRef.current.slide, mode: nextMode }),
    [apply],
  );
  const openDemoWindow = useCallback(
    async (onOtherScreen = false) => {
      const url = `/presentation/${deck.id}/demo-window#${deck.slides[stateRef.current.slide].id}`;
      const width = Math.round(Math.min(1600, window.screen.availWidth * 0.7));
      let area: ScreenArea = {
        availLeft: window.screenX + 40,
        availTop: window.screenY + 40,
        availWidth: width,
        availHeight: Math.round((width * 9) / 16),
      };
      if (onOtherScreen && canPlaceOnScreen) {
        try {
          const details = await (
            window as unknown as { getScreenDetails: () => Promise<ScreenDetails> }
          ).getScreenDetails();
          area =
            details.screens.find((item) => item !== details.currentScreen) ?? details.currentScreen;
        } catch {
          setNotice(
            "The browser did not allow window placement. The Demo Window opens on this screen instead.",
          );
        }
      }
      const existing = demoWindow.current && !demoWindow.current.closed ? demoWindow.current : null;
      if (existing) {
        // Never reload a running Demo Window: that would lose the live demo's chat.
        if (onOtherScreen) {
          existing.moveTo(area.availLeft, area.availTop);
          existing.resizeTo(area.availWidth, area.availHeight);
        }
        existing.focus();
        return;
      }
      const features = `popup=yes,left=${area.availLeft},top=${area.availTop},width=${area.availWidth},height=${area.availHeight}`;
      // After this page reloads, an empty URL finds the running window by name without reloading it.
      const opened = window.open(connected ? "" : url, `demo-window-${deck.id}`, features);
      if (!opened) {
        setNotice(
          "The browser blocked the Demo Window. Allow pop-ups for this site, then try again.",
        );
        return;
      }
      try {
        if (opened.location.href === "about:blank") opened.location.href = url;
      } catch {
        opened.location.href = url;
      }
      demoWindow.current = opened;
      opened.focus();
      if (!onOtherScreen) setNotice("");
    },
    [canPlaceOnScreen, connected, deck],
  );
  const openOutside = (href: string) => {
    window.open(href, "bank-portal-window", "popup=yes,width=1280,height=800,noopener");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTypingTarget(event.target)
      )
        return;
      const onControl =
        event.target instanceof HTMLElement && Boolean(event.target.closest("a, button"));
      const at = stateRef.current;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          goTo(at.slide + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          goTo(at.slide - 1);
          break;
        case " ":
          if (onControl) return;
          event.preventDefault();
          goTo(event.shiftKey ? at.slide - 1 : at.slide + 1);
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(deck.slides.length - 1);
          break;
        case "s":
        case "S":
          show({ kind: "slide" });
          break;
        case "b":
        case "B":
        case ".":
          show(at.mode.kind === "black" ? { kind: "slide" } : { kind: "black" });
          break;
        case "q":
        case "Q":
          show({ kind: "qr" });
          break;
        case "d":
        case "D": {
          const app = appScreenForSlide(deck.slides[at.slide]);
          if (app) show({ kind: "app", path: app.path });
          break;
        }
        case "t":
        case "T":
          setRunning((value) => !value);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, goTo, show]);

  const plannedStart = starts[slide] ?? 0;
  return (
    <div className="console">
      <header className="console-bar">
        <div className="console-bar__title">
          <p className="eyebrow">Presenter console · {deck.lengthLabel} talk</p>
          <h1>{deck.title}</h1>
        </div>
        <div className="console-bar__window" role="group" aria-label="Demo Window">
          <span className="console-status" data-connected={connected} role="status">
            {connected
              ? `Demo Window connected${screenInfo?.fullscreen ? " · full screen" : ""}`
              : "Demo Window not open"}
          </span>
          <button type="button" className="primary" onClick={() => void openDemoWindow(false)}>
            {connected ? "Bring Demo Window forward" : "Open Demo Window"}
          </button>
          {canPlaceOnScreen && (
            <button type="button" onClick={() => void openDemoWindow(true)}>
              Open on other screen
            </button>
          )}
          {onSavePresenter && (
            <PresenterDetailsButton presenter={presenter} onSave={onSavePresenter} />
          )}
        </div>
        {!isSupported() && (
          <p className="console-alert">
            This browser cannot link two windows. Use a current version of Edge, Chrome, Firefox, or
            Safari.
          </p>
        )}
        {notice && (
          <p className="console-alert" role="alert">
            {notice}
          </p>
        )}
      </header>

      <section className="console-stage" aria-labelledby="console-now">
        <div className="console-stage__heading">
          <h2 id="console-now">On the Demo Window</h2>
          <span className="surface-badge" data-surface={mode.kind === "app" ? "app" : "slides"}>
            {modeLabel(mode)}
          </span>
        </div>
        <div className="console-previews">
          <div className="console-preview" aria-hidden="true">
            {mode.kind === "slide" && <FitStage>{renderSlide(slide, presenter)}</FitStage>}
            {mode.kind === "qr" && <FitStage>{renderQr(presenter)}</FitStage>}
            {mode.kind === "black" && (
              <div className="console-preview__note">Black screen. The audience sees nothing.</div>
            )}
            {mode.kind === "app" && (
              <div className="console-preview__note">
                <strong>{modeLabel(mode)}</strong>
                <span>{mode.path}</span>
                <span>
                  Use the live site inside the Demo Window. Your clicks and typing there are what
                  the audience sees.
                </span>
              </div>
            )}
          </div>
          {next && (
            <div className="console-next">
              <p className="eyebrow">Next slide · {surfaceLabels[next.notes.surface]}</p>
              <div className="console-next__preview" aria-hidden="true">
                <FitStage>{renderSlide(slide + 1, presenter)}</FitStage>
              </div>
              <p>
                <strong>{next.title}</strong>
              </p>
            </div>
          )}
        </div>

        <nav className="console-nav" aria-label="Slide controls">
          <button
            type="button"
            onClick={() => goTo(slide - 1)}
            disabled={slide === 0}
            aria-label="Previous slide"
          >
            ← Prev
          </button>
          <span aria-live="polite">
            Slide {slide + 1} of {deck.slides.length}: {current.chip}
          </span>
          <button
            type="button"
            className="console-nav__next"
            onClick={() => goTo(slide + 1)}
            disabled={slide === deck.slides.length - 1}
            aria-label="Next slide"
          >
            Next →
          </button>
        </nav>

        <div className="console-modes" role="group" aria-label="What the Demo Window shows">
          <button
            type="button"
            aria-pressed={mode.kind === "slide"}
            onClick={() => show({ kind: "slide" })}
          >
            Slide (S)
          </button>
          {suggestedApp && (
            <button
              type="button"
              className="console-modes__primary"
              aria-pressed={mode.kind === "app" && mode.path === suggestedApp.path}
              onClick={() => show({ kind: "app", path: suggestedApp.path })}
            >
              Show {suggestedApp.label} (D)
            </button>
          )}
          <button
            type="button"
            aria-pressed={mode.kind === "qr"}
            onClick={() => show({ kind: "qr" })}
          >
            QR code (Q)
          </button>
          <button
            type="button"
            aria-pressed={mode.kind === "black"}
            onClick={() => show({ kind: "black" })}
          >
            Black screen (B)
          </button>
          <label className="console-select">
            <span>Show a site page</span>
            <select
              value={mode.kind === "app" ? mode.path : ""}
              onChange={(event) => {
                const screen = appScreenFor(event.target.value);
                if (screen) show({ kind: "app", path: screen.path });
              }}
            >
              <option value="" disabled>
                Choose a page…
              </option>
              {appScreens.map((screen) => (
                <option key={screen.path} value={screen.path}>
                  {screen.label}
                </option>
              ))}
            </select>
          </label>
          {mode.kind === "app" && (
            <button type="button" onClick={() => post({ kind: "reload-app", source: "console" })}>
              Reload page
            </button>
          )}
        </div>

        {portalLinks.length > 0 && (
          <div className="console-outside">
            <p>
              Portals cannot appear inside the Demo Window. Open them in their own clean window,
              then share that window or your screen. You need Azure access to open them.
            </p>
            <div className="button-row">
              {portalLinks.map((link) => (
                <button key={link.href} type="button" onClick={() => openOutside(link.href)}>
                  Open {link.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="console-notes" aria-label="Speaker notes">
        <div className="notes-meta">
          <span className="surface-badge" data-surface={current.notes.surface}>
            Screen: {surfaceLabels[current.notes.surface]}
          </span>
          <span>
            Plan: {formatMinutes(current.notes.minutes)} (from {formatMinutes(plannedStart)} of{" "}
            {formatMinutes(totalMinutes(deck))})
          </span>
        </div>
        <div className="talk-timer" role="group" aria-label="Talk timer">
          <strong>{formatClock(elapsed)}</strong>
          <span>{paceLabel(deck, slide, elapsed)}</span>
          <button type="button" onClick={() => setRunning((value) => !value)}>
            {running ? "Pause" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(false);
              setElapsed(0);
            }}
          >
            Reset
          </button>
        </div>
        <h2>{current.title}</h2>
        <NotesGroup title="Say" items={current.notes.say} />
        {current.notes.do && <NotesGroup title="Do" items={current.notes.do} ordered />}
        {current.notes.watch && <NotesGroup title="Point out" items={current.notes.watch} />}
        {current.notes.fallback && (
          <NotesGroup title="If it breaks" items={current.notes.fallback} />
        )}
        <p className="notes-keys">
          Keys: → or Space next · ← back · S slide · D live site · Q QR code · B black screen · T
          timer. A clicker pointed at the Demo Window also works.
        </p>
      </aside>

      <nav className="console-strip" aria-label="All slides">
        {deck.slides.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-current={index === slide ? "true" : undefined}
            onClick={() => goTo(index)}
          >
            <span>{index + 1}</span> {item.chip}
          </button>
        ))}
      </nav>

      <p className="console-links">
        <a href={`/presentation/${deck.id}`}>Slides in this window</a>
        <a href={`/presentation/${deck.id}/script`}>Presenter script</a>
        <a href="/presentation">All talks</a>
      </p>
    </div>
  );
}
