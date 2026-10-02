import type { ReactNode } from "react";
import { demoQrPath, publicDemoUrl, repoUrl } from "./constants";
import type { Deck, Slide, SlideBlock, Tone } from "./deck";
import { useLocalQr } from "./local-qr";
import { eventDateLabel, hasPresenterDetails, type Presenter } from "./presenter-details";
import { Rich } from "./rich-text";
import { slideSnippet } from "./snippets";

function toneClass(tone?: Tone) {
  return tone ? ` tone-${tone}` : "";
}

export function QrPair({
  presenter,
  compact = false,
}: {
  presenter: Presenter;
  compact?: boolean;
}) {
  const presenterQr = useLocalQr(presenter.qrUrl);
  return (
    <div className={`qr-pair${compact ? " compact" : ""}`}>
      <figure>
        <img src={demoQrPath} alt={`QR code. Scan it to open ${publicDemoUrl}`} />
        <figcaption>Demo site</figcaption>
        <p>{publicDemoUrl.replace(/\/$/, "")}</p>
      </figure>
      {presenterQr ? (
        <figure>
          <img
            src={presenterQr}
            alt={`QR code. Scan it to open ${presenter.qrLabel || "the presenter link"}.`}
          />
          <figcaption>{presenter.qrLabel || "Presenter link"}</figcaption>
          <p>{presenter.qrUrl}</p>
        </figure>
      ) : (
        <figure className="qr-placeholder">
          <div aria-hidden="true">＋</div>
          <figcaption>Presenter QR</figcaption>
          <p>Add an HTTPS presenter link before the talk.</p>
        </figure>
      )}
    </div>
  );
}

function TitleDetails({ presenter }: { presenter: Presenter }) {
  return (
    <div className="title-details">
      <p>{presenter.eventName || "Live session"}</p>
      <p>{eventDateLabel(presenter)}</p>
      {hasPresenterDetails(presenter) ? (
        <p>
          {presenter.name || "Presenter"}
          {presenter.role ? ` · ${presenter.role}` : ""}
        </p>
      ) : (
        <p>Add presenter and event details on this device.</p>
      )}
    </div>
  );
}

function Block({ block, presenter }: { block: SlideBlock; presenter: Presenter }) {
  switch (block.kind) {
    case "lead":
      return (
        <p className="slide-lead">
          <Rich text={block.text} />
        </p>
      );
    case "cards":
      return (
        <div className={`slide-cards columns-${block.columns ?? 2}`}>
          {block.items.map((item) => (
            <article className={`slide-card${toneClass(item.tone)}`} key={item.title}>
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              <h3>{item.title}</h3>
              <p>
                <Rich text={item.text} />
              </p>
            </article>
          ))}
        </div>
      );
    case "steps":
      return (
        <ol className="slide-steps">
          {block.items.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>
                <Rich text={item.text} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "bullets":
      return (
        <ul className="slide-bullets">
          {block.items.map((item) => (
            <li key={item}>
              <Rich text={item} />
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="slide-quote">
          <Rich text={block.text} />
        </blockquote>
      );
    case "chain":
      return (
        <div className="slide-chain" aria-label={block.label}>
          {block.items.map((item) => (
            <span key={item}>
              <Rich text={item} />
            </span>
          ))}
        </div>
      );
    case "compare":
      return (
        <div className="slide-compare">
          {[block.left, block.right].map((side) => (
            <article className={toneClass(side.tone)} key={side.title}>
              <h3>{side.title}</h3>
              <ul>
                {side.items.map((item) => (
                  <li key={item}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="table-wrap">
          <table>
            <caption>{block.caption}</caption>
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell) => (
                    <td key={cell}>
                      <Rich text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image":
      return (
        <figure className="slide-image">
          <img src={block.src} alt={block.alt} />
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    case "flow":
      return (
        <ol className="slide-flow" aria-label={block.label}>
          {block.items.map((step) => (
            <li
              className={`flow-step${step.check ? " flow-check" : ""}${toneClass(step.tone)}`}
              key={step.title}
            >
              <h3>{step.title}</h3>
              <p>
                <Rich text={step.text} />
              </p>
              {step.outcomes && (
                <ul className="flow-outcomes">
                  {step.outcomes.map((outcome) => (
                    <li className={`flow-outcome${toneClass(outcome.tone)}`} key={outcome.label}>
                      <strong>{outcome.label}</strong> <Rich text={outcome.text} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      );
    case "snippet":
      return (
        <div className={`slide-snippets count-${block.items.length}`}>
          {block.items.map((item) => {
            const snippet = slideSnippet(item.id);
            return (
              <figure className="slide-code slide-snippet" key={item.id}>
                <figcaption>{item.caption}</figcaption>
                {/* Build-time highlight.js HTML from this repository's own source. */}
                <div dangerouslySetInnerHTML={{ __html: snippet.html }} />
                <a
                  className="snippet-source"
                  href={snippet.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub · {snippet.file} · lines {snippet.first}–{snippet.last}
                </a>
              </figure>
            );
          })}
        </div>
      );
    case "code":
      return (
        <figure className="slide-code">
          <figcaption>{block.caption}</figcaption>
          <pre>
            <code>{block.code}</code>
          </pre>
          {block.source && (
            <a
              className="snippet-source"
              href={`${repoUrl}/blob/main/${block.source}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub · {block.source}
            </a>
          )}
        </figure>
      );
    case "launch":
      return (
        <p className="launch-links">
          {block.text && <span>{block.text} </span>}
          {block.links.map((link) => (
            <a className="button" key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </p>
      );
    case "timeline":
      return (
        <ol className="slide-timeline">
          {block.items.map((item) => (
            <li key={item.when}>
              <time>{item.when}</time>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      );
    case "honest":
      return (
        <aside className="honest-callout">
          <strong>In this demo:</strong> <Rich text={block.text} />
        </aside>
      );
    case "qr":
      return <QrPair presenter={presenter} compact />;
  }
}

export function SlideFrame({
  deck,
  slide,
  index,
  presenter,
  footer,
}: {
  deck: Deck;
  slide: Slide;
  index: number;
  presenter: Presenter;
  footer?: ReactNode;
}) {
  return (
    <article className="slide-frame" aria-labelledby={`slide-title-${slide.id}`}>
      <header>
        <p className="slide-kicker">{slide.eyebrow || deck.kicker}</p>
        <h2 id={`slide-title-${slide.id}`}>{slide.title}</h2>
        {slide.id === "title" && <TitleDetails presenter={presenter} />}
      </header>
      <div className="slide-blocks">
        {slide.blocks.map((block, blockIndex) => (
          <Block
            key={`${slide.id}-${block.kind}-${blockIndex}`}
            block={block}
            presenter={presenter}
          />
        ))}
      </div>
      <footer>
        <span>For demo purposes only</span>
        <span>
          {index + 1} / {deck.slides.length}
        </span>
      </footer>
      {footer}
    </article>
  );
}
