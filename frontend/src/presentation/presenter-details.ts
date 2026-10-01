import { useCallback, useState } from "react";

export const presenterStorageKey = "demo-presenter";
export const presenterLimits = {
  name: 80,
  role: 80,
  eventName: 100,
  qrLabel: 40,
  qrUrl: 300,
} as const;

export type Presenter = {
  name: string;
  role: string;
  qrUrl: string;
  qrLabel: string;
  eventName: string;
  eventDate: string;
};

export const emptyPresenter: Presenter = {
  name: "",
  role: "",
  qrUrl: "",
  qrLabel: "",
  eventName: "",
  eventDate: "",
};

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

export function normalizePresenterUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > presenterLimits.qrUrl) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes("."))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function validEventDate(value: unknown) {
  if (typeof value !== "string") return "";
  const match = datePattern.exec(value);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
    ? value
    : "";
}

export function cleanPresenter(value: unknown): Presenter {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    name: text(raw.name, presenterLimits.name),
    role: text(raw.role, presenterLimits.role),
    qrUrl: normalizePresenterUrl(raw.qrUrl) ?? "",
    qrLabel: text(raw.qrLabel, presenterLimits.qrLabel),
    eventName: text(raw.eventName, presenterLimits.eventName),
    eventDate: validEventDate(raw.eventDate),
  };
}

export function hasPresenterDetails(presenter: Presenter) {
  return Object.values(presenter).some(Boolean);
}

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function eventDateLabel(
  presenter: Pick<Presenter, "eventDate">,
  now = new Date(),
  locale = "en-US",
) {
  const match = datePattern.exec(validEventDate(presenter.eventDate));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : now;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(
    date,
  );
}

export function readPresenter(): Presenter {
  try {
    return cleanPresenter(JSON.parse(localStorage.getItem(presenterStorageKey) ?? "null"));
  } catch {
    return emptyPresenter;
  }
}

export function usePresenter(): [Presenter, (next: Presenter) => void] {
  const [presenter, setPresenter] = useState(readPresenter);
  const save = useCallback((next: Presenter) => {
    const value = cleanPresenter(next);
    try {
      if (hasPresenterDetails(value))
        localStorage.setItem(presenterStorageKey, JSON.stringify(value));
      else localStorage.removeItem(presenterStorageKey);
    } catch {
      // Private browsing can block storage. The details still show until this page closes.
    }
    setPresenter(value);
  }, []);
  return [presenter, save];
}
