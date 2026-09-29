import { t } from "../i18n";

interface Props {
  onChoose: (value: "analytics" | "necessary") => void;
}

export function CookieBanner({ onChoose }: Props) {
  const s = t();
  return (
    <section
      className="cookie-banner"
      role="dialog"
      aria-labelledby="cookie-title"
      aria-live="polite"
    >
      <h2 id="cookie-title">{s.cookie.title}</h2>
      <p>
        {s.cookie.body} <a href="#/privacy">{s.footer.privacy}</a>
      </p>
      <div className="button-row">
        <button type="button" className="primary" onClick={() => onChoose("analytics")}>
          {s.cookie.accept}
        </button>
        <button type="button" onClick={() => onChoose("necessary")}>
          {s.cookie.reject}
        </button>
      </div>
    </section>
  );
}
