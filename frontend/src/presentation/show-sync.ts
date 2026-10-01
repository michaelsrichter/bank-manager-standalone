import { useCallback, useEffect, useRef } from "react";
import { cleanPresenter, type Presenter } from "./presenter-details";

export const appScreens = [
  { path: "/#/demo", label: "Live demo" },
  { path: "/#/demo?mode=practice", label: "Practice backup" },
  { path: "/#/health", label: "Service status" },
  { path: "/#/docs/governance-tour.md", label: "Governance code tour" },
  { path: "/#/docs/architecture/diagram.md", label: "Architecture diagrams" },
] as const;

export type AppScreen = (typeof appScreens)[number];
export type ScreenMode =
  { kind: "slide" } | { kind: "app"; path: AppScreen["path"] } | { kind: "qr" } | { kind: "black" };
export type ShowState = {
  slide: number;
  mode: ScreenMode;
  presenter: Presenter;
  theme: "dark" | "light";
};
export type ScreenCommand = "next" | "prev" | "first" | "last" | "toggle-black";
export type ShowMessage =
  | { kind: "state"; source: "console"; state: ShowState }
  | { kind: "hello"; source: "console" | "screen" }
  | { kind: "heartbeat"; source: "screen"; slide: number; mode: ScreenMode; fullscreen: boolean }
  | { kind: "command"; source: "screen"; command: ScreenCommand }
  | { kind: "reload-app"; source: "console" };

export const heartbeatMs = 2000;
export const staleAfterMs = 5000;
export function channelName(deckId: string) {
  return `demo-presentation:${deckId}`;
}
export function appScreenFor(path: string) {
  return appScreens.find((screen) => screen.path === path);
}
const commands: readonly ScreenCommand[] = ["next", "prev", "first", "last", "toggle-black"];
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function parseMode(value: unknown): ScreenMode | null {
  if (!isRecord(value)) return null;
  if (value.kind === "slide" || value.kind === "qr" || value.kind === "black")
    return { kind: value.kind };
  if (value.kind === "app" && typeof value.path === "string") {
    const screen = appScreenFor(value.path);
    return screen ? { kind: "app", path: screen.path } : null;
  }
  return null;
}
function parseSlide(value: unknown, slideCount: number) {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < slideCount
    ? (value as number)
    : null;
}
export function parseShowMessage(data: unknown, slideCount: number): ShowMessage | null {
  if (!isRecord(data)) return null;
  if (data.kind === "hello" && (data.source === "console" || data.source === "screen"))
    return { kind: "hello", source: data.source };
  if (data.kind === "reload-app" && data.source === "console")
    return { kind: "reload-app", source: "console" };
  if (
    data.kind === "command" &&
    data.source === "screen" &&
    commands.includes(data.command as ScreenCommand)
  )
    return { kind: "command", source: "screen", command: data.command as ScreenCommand };
  if (data.kind === "heartbeat" && data.source === "screen") {
    const slide = parseSlide(data.slide, slideCount);
    const mode = parseMode(data.mode);
    return slide === null || !mode
      ? null
      : { kind: "heartbeat", source: "screen", slide, mode, fullscreen: data.fullscreen === true };
  }
  if (data.kind === "state" && data.source === "console" && isRecord(data.state)) {
    const slide = parseSlide(data.state.slide, slideCount);
    const mode = parseMode(data.state.mode);
    if (slide === null || !mode) return null;
    return {
      kind: "state",
      source: "console",
      state: {
        slide,
        mode,
        presenter: cleanPresenter(data.state.presenter),
        theme: data.state.theme === "light" ? "light" : "dark",
      },
    };
  }
  return null;
}
export function commandForKey(key: string): ScreenCommand | null {
  switch (key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
    case "ArrowDown":
      return "next";
    case "ArrowLeft":
    case "PageUp":
    case "ArrowUp":
    case "Backspace":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "b":
    case "B":
    case ".":
      return "toggle-black";
    default:
      return null;
  }
}
export function applyCommand(
  state: ShowState,
  command: ScreenCommand,
  slideCount: number,
): ShowState {
  switch (command) {
    case "next":
      return {
        ...state,
        slide: Math.min(slideCount - 1, state.slide + 1),
        mode: { kind: "slide" },
      };
    case "prev":
      return { ...state, slide: Math.max(0, state.slide - 1), mode: { kind: "slide" } };
    case "first":
      return { ...state, slide: 0, mode: { kind: "slide" } };
    case "last":
      return { ...state, slide: slideCount - 1, mode: { kind: "slide" } };
    case "toggle-black":
      return {
        ...state,
        mode: state.mode.kind === "black" ? { kind: "slide" } : { kind: "black" },
      };
  }
}
export function isSupported() {
  return typeof BroadcastChannel !== "undefined";
}
export function useShowChannel(
  deckId: string,
  slideCount: number,
  onMessage: (message: ShowMessage) => void,
) {
  const channel = useRef<BroadcastChannel | null>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  useEffect(() => {
    if (!isSupported()) return;
    const opened = new BroadcastChannel(channelName(deckId));
    channel.current = opened;
    opened.onmessage = (event: MessageEvent) => {
      const message = parseShowMessage(event.data, slideCount);
      if (message) handler.current(message);
    };
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [deckId, slideCount]);
  return useCallback((message: ShowMessage) => channel.current?.postMessage(message), []);
}
