// A small button that copies text and says so for screen readers.
// Falls back to the older copy command when the Clipboard API is blocked,
// for example inside a frame or when the page does not have focus.
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

export async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the older way below.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const s = t().demo;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className="copy-button"
      data-state={state}
      aria-label={s.copyLabel(label)}
      onClick={async () => {
        const copied = await writeClipboard(text);
        setState(copied ? "copied" : "failed");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 2000);
      }}
    >
      <span aria-live="polite">
        {state === "copied" ? s.copied : state === "failed" ? s.copyBlocked : s.copy}
      </span>
    </button>
  );
}
