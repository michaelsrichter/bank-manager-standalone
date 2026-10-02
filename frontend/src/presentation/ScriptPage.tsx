import { formatMinutes, slideStartTimes, totalMinutes, type Deck } from "./deck";
import type { Presenter } from "./presenter-details";
import { PresenterDetailsButton } from "./PresenterDetailsDialog";
import { Rich } from "./rich-text";

function List({ items, ordered = false }: { items?: string[]; ordered?: boolean }) {
  if (!items?.length) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((item) => (
        <li key={item}>
          <Rich text={item} />
        </li>
      ))}
    </Tag>
  );
}

export function ScriptPage({
  deck,
  presenter,
  onSavePresenter,
}: {
  deck: Deck;
  presenter: Presenter;
  onSavePresenter: (presenter: Presenter) => void;
}) {
  const starts = slideStartTimes(deck);
  return (
    <article className="presentation-page script-page prose">
      <header className="script-header">
        <p className="eyebrow">Printable presenter script</p>
        <h1>{deck.title}</h1>
        <p>
          {deck.kicker} · {formatMinutes(totalMinutes(deck))} planned minutes
        </p>
        <div className="button-row">
          <a className="button" href={`/presentation/${deck.id}`}>
            Slides
          </a>
          <a className="button" href={`/presentation/${deck.id}/console`}>
            Presenter console
          </a>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
          <PresenterDetailsButton presenter={presenter} onSave={onSavePresenter} />
        </div>
      </header>
      <section>
        <h2>Get ready</h2>
        <List items={deck.prep} />
      </section>
      <section>
        <h2>Tabs to open</h2>
        <ul>
          <li>
            Public app: <a href="/#/demo">Live demo</a>.
          </li>
          <li>
            Practice backup: <a href="/#/demo?mode=practice">Practice mode</a>.
          </li>
          <li>
            Azure portal, in its own signed-in window: the{" "}
            <strong>Governed AI Bank Assistant — telemetry</strong> workbook, the{" "}
            <strong>answer review</strong> workbook, the <strong>Governed AI Bank Assistant</strong>{" "}
            dashboard, and Application Insights <strong>Logs</strong>. Sign in before the audience
            joins.
          </li>
        </ul>
      </section>
      <section>
        <h2>Run of show</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Slide</th>
                <th>Screen</th>
                <th>Start</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {deck.slides.map((slide, index) => (
                <tr key={slide.id}>
                  <td>{index + 1}</td>
                  <td>{slide.chip}</td>
                  <td>{slide.notes.surface}</td>
                  <td>{formatMinutes(starts[index] ?? 0)}</td>
                  <td>{formatMinutes(slide.notes.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {deck.slides.map((slide, index) => (
        <section className="script-slide" key={slide.id}>
          <h2>
            {index + 1}. {slide.title}
          </h2>
          <p>
            <strong>Screen:</strong> {slide.notes.surface} · <strong>Time:</strong>{" "}
            {formatMinutes(slide.notes.minutes)}
          </p>
          <h3>Say</h3>
          <List items={slide.notes.say} />
          {slide.notes.do && (
            <>
              <h3>Do</h3>
              <List items={slide.notes.do} ordered />
            </>
          )}
          {slide.notes.watch && (
            <>
              <h3>Point out</h3>
              <List items={slide.notes.watch} />
            </>
          )}
          {slide.notes.fallback && (
            <>
              <h3>If it breaks</h3>
              <List items={slide.notes.fallback} />
            </>
          )}
        </section>
      ))}
    </article>
  );
}
