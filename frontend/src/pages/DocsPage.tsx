import docs from "../generated/docs.json";
import { t } from "../i18n";

interface DocPage {
  title: string;
  html: string;
}

const PAGES = (docs as { pages: Record<string, DocPage> }).pages;

export function DocsPage({ doc, pages = PAGES }: { doc: string; pages?: Record<string, DocPage> }) {
  const s = t().docs;
  const key = doc.endsWith("/") ? `${doc}README.md` : doc;
  const page = pages[key];
  return (
    <article className="page prose docs">
      <p>
        <a href="#/docs/README.md">← {s.index}</a>
      </p>
      {page ? (
        // Build-time HTML generated from this repository's own /docs Markdown.
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
      ) : (
        <>
          <h1>{s.title}</h1>
          <p role="alert">{s.notFound}</p>
        </>
      )}
    </article>
  );
}
