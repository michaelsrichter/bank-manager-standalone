import { useRef, useState } from "react";
import { useLocalQr } from "./local-qr";
import {
  cleanPresenter,
  emptyPresenter,
  normalizePresenterUrl,
  presenterQrLabel,
  todayIso,
  type Presenter,
} from "./presenter-details";

type Props = { presenter: Presenter; onSave: (presenter: Presenter) => void };

export function PresenterDetailsButton({ presenter, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Presenter>(presenter);
  const [error, setError] = useState("");
  const qrPreview = useLocalQr(draft.qrUrl);
  const qrLink = normalizePresenterUrl(draft.qrUrl);
  const qrState = !draft.qrUrl.trim() ? "empty" : qrLink ? "ok" : "bad";
  const open = () => {
    setDraft(presenter);
    setError("");
    dialog.current?.showModal();
  };
  const update = (field: keyof Presenter, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const save = () => {
    const cleaned = cleanPresenter(draft);
    if (draft.qrUrl.trim() && !cleaned.qrUrl) {
      setError("Use a web link that starts with https://, without a username or password.");
      return;
    }
    if (draft.eventDate && !cleaned.eventDate) {
      setError("Choose a real event date.");
      return;
    }
    onSave(cleaned);
    setError("");
    dialog.current?.close();
  };
  const remove = () => {
    onSave(emptyPresenter);
    setDraft(emptyPresenter);
    setError("");
    dialog.current?.close();
  };
  return (
    <>
      <button type="button" onClick={open}>
        Presenter details
      </button>
      <dialog ref={dialog} className="presenter-dialog" aria-labelledby="presenter-title">
        <h2 id="presenter-title">Presenter and event details</h2>
        <p>These details stay in this browser. They are never sent to the demo services.</p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <label>
          Name
          <input value={draft.name} onChange={(event) => update("name", event.target.value)} />
        </label>
        <label>
          Job title and company
          <input value={draft.role} onChange={(event) => update("role", event.target.value)} />
        </label>
        <label>
          Event name
          <input
            value={draft.eventName}
            onChange={(event) => update("eventName", event.target.value)}
          />
        </label>
        <label>
          Event date
          <input
            type="date"
            value={draft.eventDate || todayIso()}
            onChange={(event) => update("eventDate", event.target.value)}
          />
        </label>
        <label>
          Your link for a QR code
          <input
            value={draft.qrUrl}
            inputMode="url"
            placeholder="https://www.linkedin.com/in/your-name"
            aria-describedby="presenter-qr-help"
            onChange={(event) => update("qrUrl", event.target.value)}
          />
        </label>
        <p id="presenter-qr-help" className="field-hint">
          Paste your LinkedIn profile or any web link. This browser makes the QR code; nothing is
          sent anywhere. It shows on the first and last slides, and when you press <kbd>Q</kbd>.
        </p>
        <label>
          Label under the QR code (optional)
          <input
            value={draft.qrLabel}
            placeholder={presenterQrLabel({ qrLabel: "", qrUrl: draft.qrUrl })}
            onChange={(event) => update("qrLabel", event.target.value)}
          />
        </label>
        <div className="qr-preview" aria-live="polite">
          {qrState === "ok" && qrPreview && (
            <figure>
              <img src={qrPreview} alt={`Preview of your QR code for ${qrLink}`} />
              <figcaption>
                <strong>{presenterQrLabel(draft)}</strong>
                <span>{qrLink}</span>
                <a href={qrPreview} download="presenter-qr.svg">
                  Download QR code (SVG)
                </a>
              </figcaption>
            </figure>
          )}
          {qrState === "bad" && (
            <p className="field-hint warn">
              This link can't become a QR code yet. Use a web link like
              https://www.linkedin.com/in/your-name, without a username or password.
            </p>
          )}
        </div>
        <div className="button-row">
          <button type="button" className="primary" onClick={save}>
            Save details
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={remove}>
            Remove my details
          </button>
        </div>
      </dialog>
    </>
  );
}
