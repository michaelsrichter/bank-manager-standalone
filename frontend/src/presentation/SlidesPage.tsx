import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatMinutes,
  paceLabel,
  slideStartTimes,
  totalMinutes,
  type Deck,
  type Slide,
} from "./deck";
import { PresenterDetailsButton } from "./PresenterDetailsDialog";
import type { Presenter } from "./presenter-details";
import { Rich } from "./rich-text";
import { SlideFrame } from "./SlideFrame";

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], dialog'))
  );
}

function Notes({
  deck,
  slide,
  index,
  elapsed,
  running,
  onTimer,
}: {
  deck: Deck;
  slide: Slide;
  index: number;
  elapsed: number;
  running: boolean;
  onTimer: () => void;
}) {
  const starts = slideStartTimes(deck);
  const next = deck.slides[index + 1];
  return (
    <aside className="notes-drawer" aria-label="Speaker notes">
      <p>
        <strong>Screen:</strong> {slide.notes.surface} · <strong>Plan:</strong>{" "}
        {formatMinutes(slide.notes.minutes)} · <strong>{paceLabel(deck, index, elapsed)}</strong>
      </p>
      <button type="button" onClick={onTimer}>
        {running ? "Pause timer" : "Start timer"}
      </button>
      <p>
        Start around {formatMinutes(starts[index] ?? 0)} of {formatMinutes(totalMinutes(deck))}
      </p>
      <h3>Say</h3>
      <ul>
        {slide.notes.say.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
      {slide.notes.do && (
        <>
          <h3>Do</h3>
          <ol>
            {slide.notes.do.map((item) => (
              <li key={item}>
                <Rich text={item} />
              </li>
            ))}
          </ol>
        </>
      )}
      {slide.notes.watch && (
        <>
          <h3>Point out</h3>
          <ul>
            {slide.notes.watch.map((item) => (
              <li key={item}>
                <Rich text={item} />
              </li>
            ))}
          </ul>
        </>
      )}
      {slide.notes.fallback && (
        <>
          <h3>If it breaks</h3>
          <ul>
            {slide.notes.fallback.map((item) => (
              <li key={item}>
                <Rich text={item} />
              </li>
            ))}
          </ul>
        </>
      )}
      {next && (
        <p>
          <strong>Next:</strong> {next.chip} — {next.title}
        </p>
      )}
    </aside>
  );
}

export function SlidesPage({
  deck,
  presenter,
  onSavePresenter,
}: {
  deck: Deck;
  presenter: Presenter;
  onSavePresenter: (presenter: Presenter) => void;
}) {
  const initial = Math.max(
    0,
    deck.slides.findIndex(
      (slide) => slide.id === decodeURIComponent(window.location.hash.slice(1)),
    ),
  );
  const [current, setCurrent] = useState(initial);
  const [notesOpen, setNotesOpen] = useState(
    () => new URLSearchParams(window.location.search).get("notes") === "1",
  );
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );
  const goTo = useCallback(
    (index: number) => {
      const next = Math.min(deck.slides.length - 1, Math.max(0, index));
      setCurrent(next);
      window.history.replaceState(null, "", `${window.location.pathname}#${deck.slides[next].id}`);
      refs.current[next]?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [deck, reducedMotion],
  );
  useEffect(() => {
    if (!window.location.hash)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}#${deck.slides[current].id}`,
      );
  }, [current, deck]);
  // Open a shared link such as /presentation/session#rego on that slide.
  useEffect(() => {
    if (initial > 0) refs.current[initial]?.scrollIntoView({ block: "start" });
    const onHash = () => {
      const index = deck.slides.findIndex(
        (slide) => slide.id === decodeURIComponent(window.location.hash.slice(1)),
      );
      if (index >= 0) goTo(index);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, goTo]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          goTo(current + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          goTo(current - 1);
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(deck.slides.length - 1);
          break;
        case "n":
        case "N":
          setNotesOpen((value) => !value);
          break;
        case "t":
        case "T":
          setRunning((value) => !value);
          break;
        case "f":
        case "F":
          void document.documentElement.requestFullscreen?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, deck.slides.length, goTo]);
  const slide = deck.slides[current];
  return (
    <div className="presentation-page slides-page">
      <section className="talk-card">
        <p className="eyebrow">{deck.kicker}</p>
        <h1>{deck.title}</h1>
        <p>{deck.summary}</p>
        <p>
          <strong>Audience:</strong> {deck.audience}
        </p>
        <div className="button-row">
          <a className="button primary" href={`/presentation/${deck.id}/script`}>
            Presenter script
          </a>
          <a className="button" href={`/presentation/${deck.id}/console`}>
            Presenter console
          </a>
          <PresenterDetailsButton presenter={presenter} onSave={onSavePresenter} />
        </div>
        <nav aria-label="Slides">
          {deck.slides.map((item, index) => (
            <button
              type="button"
              key={item.id}
              aria-current={index === current}
              onClick={() => goTo(index)}
            >
              {index + 1}. {item.chip}
            </button>
          ))}
        </nav>
      </section>
      {deck.slides.map((item, index) => (
        <section
          className="slide-section"
          id={item.id}
          key={item.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
        >
          <SlideFrame deck={deck} slide={item} index={index} presenter={presenter} />
        </section>
      ))}
      <nav className="slide-pager" aria-label="Slide pager">
        <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0}>
          Prev
        </button>
        <span aria-live="polite">
          {current + 1} / {deck.slides.length}: {slide.chip}
        </span>
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          disabled={current === deck.slides.length - 1}
        >
          Next
        </button>
        <button type="button" onClick={() => setNotesOpen((value) => !value)}>
          Notes
        </button>
      </nav>
      {notesOpen && (
        <Notes
          deck={deck}
          slide={slide}
          index={current}
          elapsed={elapsed}
          running={running}
          onTimer={() => setRunning((value) => !value)}
        />
      )}
    </div>
  );
}
