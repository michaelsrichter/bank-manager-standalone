import "./presentation.css";
import { demoQrPath, publicDemoUrl } from "./constants";
import { decks, getDeck, totalMinutes } from "./deck";
import DemoWindow from "./DemoWindow";
import PresenterConsole from "./PresenterConsole";
import { usePresenter, type Presenter } from "./presenter-details";
import { PresenterDetailsButton } from "./PresenterDetailsDialog";
import { ScriptPage } from "./ScriptPage";
import { QrPair, SlideFrame } from "./SlideFrame";
import { SlidesPage } from "./SlidesPage";

function pathParts() {
  return window.location.pathname
    .replace(/^\/presentation\/?/, "")
    .split("/")
    .filter(Boolean);
}

function TalksPage({
  presenter,
  onSavePresenter,
}: {
  presenter: Presenter;
  onSavePresenter: (presenter: Presenter) => void;
}) {
  return (
    <article className="presentation-page talks-page">
      <p className="eyebrow">Presentation experience</p>
      <h1>Talk slides and presenter tools</h1>
      <p className="lead">
        Use these opt-in routes to present the Governed AI Bank Assistant demo without PowerPoint.
      </p>
      <div className="button-row">
        <PresenterDetailsButton presenter={presenter} onSave={onSavePresenter} />
      </div>
      <section className="talk-grid">
        {decks.map((deck) => (
          <article className="talk-card" key={deck.id}>
            <img src={demoQrPath} alt={`QR code. Scan it to open ${publicDemoUrl}`} />
            <div>
              <p className="eyebrow">{deck.kicker}</p>
              <h2>{deck.title}</h2>
              <p>{deck.summary}</p>
              <p>
                <strong>{deck.lengthLabel}</strong> · {totalMinutes(deck)} planned minutes
              </p>
              <p>{deck.audience}</p>
              <div className="button-row">
                <a className="button primary" href={`/presentation/${deck.id}`}>
                  Talk slides
                </a>
                <a className="button" href={`/presentation/${deck.id}/script`}>
                  Presenter script
                </a>
                <a className="button" href={`/presentation/${deck.id}/console`}>
                  Presenter console
                </a>
              </div>
            </div>
          </article>
        ))}
      </section>
    </article>
  );
}

function NotFound() {
  return (
    <article className="presentation-page">
      <h1>Presentation not found</h1>
      <p>Choose a talk from the presentation page.</p>
      <a className="button" href="/presentation">
        Presentation home
      </a>
    </article>
  );
}

type AppProps = {
  /** The site theme. The console sends it to the Demo Window so both screens match. */
  theme?: "dark" | "light";
  onThemeChange?: (theme: "dark" | "light") => void;
};

export default function PresentationApp({ theme, onThemeChange }: AppProps = {}) {
  const siteTheme =
    theme ?? (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [presenter, savePresenter] = usePresenter();
  const [deckId, route] = pathParts();
  if (!deckId) return <TalksPage presenter={presenter} onSavePresenter={savePresenter} />;
  const deck = getDeck(deckId);
  if (!deck) return <NotFound />;
  const renderSlide = (index: number, shownPresenter: Presenter) => (
    <SlideFrame deck={deck} slide={deck.slides[index]} index={index} presenter={shownPresenter} />
  );
  const renderQr = (shownPresenter: Presenter) => (
    <article className="slide-frame qr-screen">
      <header>
        <p className="slide-kicker">Scan to continue</p>
        <h2>Try it yourself</h2>
      </header>
      <QrPair presenter={shownPresenter} />
      <footer>
        <span>For demo purposes only</span>
        <span>{deck.title}</span>
      </footer>
    </article>
  );
  if (route === "script")
    return <ScriptPage deck={deck} presenter={presenter} onSavePresenter={savePresenter} />;
  if (route === "console")
    return (
      <PresenterConsole
        deck={deck}
        presenter={presenter}
        onSavePresenter={savePresenter}
        theme={siteTheme}
        renderSlide={renderSlide}
        renderQr={renderQr}
      />
    );
  if (route === "demo-window")
    return (
      <DemoWindow
        deck={deck}
        renderSlide={renderSlide}
        renderQr={renderQr}
        onThemeChange={onThemeChange}
      />
    );
  return <SlidesPage deck={deck} presenter={presenter} onSavePresenter={savePresenter} />;
}
