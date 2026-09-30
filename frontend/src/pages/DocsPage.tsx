import { useEffect, useRef } from "react";
import docs from "../generated/docs.json";
import { t } from "../i18n";

interface DocPage {
  title: string;
  html: string;
}

const PAGES = (docs as { pages: Record<string, DocPage> }).pages;

type Clipboard = Pick<globalThis.Clipboard, "writeText">;

/** Wrap each code block with a keyboard-accessible Copy button. */
export function addCopyButtons(root: HTMLElement, clipboard?: Clipboard): void {
  const s = t().docs;
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement?.classList.contains("code-block")) return;
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = s.copy;
    button.setAttribute("aria-label", s.copyLabel);
    button.addEventListener("click", async () => {
      try {
        await (clipboard ?? navigator.clipboard).writeText(pre.textContent ?? "");
        button.textContent = s.copied;
      } catch {
        button.textContent = s.copyFailed;
      }
      window.setTimeout(() => (button.textContent = s.copy), 1500);
    });
    wrap.appendChild(button);
  });
}

export function DocsPage({ doc, pages = PAGES }: { doc: string; pages?: Record<string, DocPage> }) {
  const s = t().docs;
  const key = doc.endsWith("/") ? `${doc}README.md` : doc;
  const page = pages[key];
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (content.current) addCopyButtons(content.current);
  }, [page]);

  return (
    <article className="page prose docs">
      <p>
        <a href="#/docs/README.md">← {s.index}</a>
      </p>
      {page ? (
        // Build-time HTML generated from this repository's own /docs Markdown.
        <div ref={content} dangerouslySetInnerHTML={{ __html: page.html }} />
      ) : (
        <>
          <h1>{s.title}</h1>
          <p role="alert">{s.notFound}</p>
        </>
      )}
    </article>
  );
}
