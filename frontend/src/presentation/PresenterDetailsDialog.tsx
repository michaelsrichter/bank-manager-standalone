import { useRef, useState } from "react";
import { cleanPresenter, emptyPresenter, todayIso, type Presenter } from "./presenter-details";

type Props = { presenter: Presenter; onSave: (presenter: Presenter) => void };

export function PresenterDetailsButton({ presenter, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Presenter>(presenter);
  const [error, setError] = useState("");
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
      setError("Use an HTTPS link without a username or password.");
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
          Presenter QR label
          <input
            value={draft.qrLabel}
            placeholder="LinkedIn"
            onChange={(event) => update("qrLabel", event.target.value)}
          />
        </label>
        <label>
          Presenter QR HTTPS link
          <input
            value={draft.qrUrl}
            placeholder="https://example.com/me"
            onChange={(event) => update("qrUrl", event.target.value)}
          />
        </label>
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
