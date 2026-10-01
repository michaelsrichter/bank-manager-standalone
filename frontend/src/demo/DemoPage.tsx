import { useEffect, useReducer, useState, type FormEvent } from "react";
import { Skeleton } from "../components/Skeleton";
import { t } from "../i18n";
import * as defaultApi from "../lib/api";
import {
  RateLimitedError,
  StreamStalledError,
  sendClientTiming,
  type ClientTiming,
} from "../lib/api";
import { loadConsent } from "../lib/preferences";
import { StreamTimer } from "../lib/timing";
import { loadProfile, resetProfile, type Profile } from "../lib/profile";
import type { AppConfig, PolicyState } from "../lib/types";
import {
  clearState,
  currentThread,
  initialState,
  loadState,
  reducer,
  saveState,
  type Turn,
} from "./state";
import { TurnCard } from "./TurnCard";

type Api = Pick<typeof defaultApi, "getConfig" | "streamCompare" | "resolveApproval">;

interface Props {
  api?: Api;
  storage?: Storage;
  newId?: () => string;
  now?: () => string;
  reportTiming?: (timing: ClientTiming) => void;
  /** Practice skips the AI model and uses recorded tool choices. Policy checks still run. */
  practice?: boolean;
}

const SETTINGS_KEY = "bm.settings.v1";
const DEFAULT_POLICY: PolicyState = {
  restrictedMode: false,
  customerApproved: false,
  adminMode: false,
};

interface Settings {
  personaId: string;
  modelKey: string;
  policyState: PolicyState;
}

function loadSettings(storage: Storage): Partial<Settings> {
  try {
    return (JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>) ?? {};
  } catch {
    return {};
  }
}

export function DemoPage({
  api = defaultApi,
  storage = localStorage,
  newId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  reportTiming = sendClientTiming,
  practice = false,
}: Props) {
  const s = t().demo;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => loadProfile(storage));
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = loadSettings(storage);
    return {
      personaId: saved.personaId ?? "M-101",
      modelKey: saved.modelKey ?? "",
      policyState: { ...DEFAULT_POLICY, ...saved.policyState },
    };
  });
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    loadState(storage, initialState(newId(), settings.personaId, now())),
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then((loaded) => {
        setConfig(loaded);
        setSettings((current) => ({
          ...current,
          personaId: loaded.personas.some((p) => p.id === current.personaId)
            ? current.personaId
            : loaded.defaultPersona,
          modelKey: loaded.models.some((m) => m.key === current.modelKey)
            ? current.modelKey
            : loaded.defaultModel,
        }));
      })
      .catch(() => setConfigFailed(true));
  }, [api]);

  useEffect(() => saveState(storage, state), [storage, state]);
  useEffect(() => storage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [storage, settings]);

  const thread = currentThread(state);
  const persona = config?.personas.find((p) => p.id === settings.personaId);
  const model = config?.models.find((m) => m.key === settings.modelKey);

  const startNewThread = (personaId = settings.personaId) =>
    dispatch({ type: "thread.new", id: newId(), personaId, createdAt: now() });

  const changeContext = (change: Partial<Settings>) => {
    const next = {
      ...settings,
      ...change,
      policyState: { ...settings.policyState, ...change.policyState },
    };
    setSettings(next);
    if (thread.turns.length > 0 && (change.personaId || change.policyState)) {
      startNewThread(next.personaId);
    }
  };

  async function run(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !config || !model || busy) return;
    const turn: Turn = {
      id: newId(),
      prompt: trimmed,
      personaId: settings.personaId,
      modelKey: model.key,
      modelLabel: model.label,
      policyState: settings.policyState,
      status: "streaming",
      steps: [],
      conversationId: thread.id,
      practice,
    };
    dispatch({ type: "turn.start", turn });
    setPrompt("");
    setBusy(true);
    const timer = new StreamTimer();
    try {
      await api.streamCompare(
        {
          prompt: trimmed,
          personaId: turn.personaId,
          modelKey: turn.modelKey,
          policyState: turn.policyState,
        },
        profile.id,
        (event) => {
          timer.event(event.type);
          dispatch({ type: "turn.event", turnId: turn.id, event });
        },
        { context: { conversationId: thread.id, practice } },
      );
    } catch (error) {
      timer.outcome =
        error instanceof RateLimitedError
          ? "rate_limited"
          : error instanceof StreamStalledError
            ? "stalled"
            : "error";
      if (error instanceof RateLimitedError) {
        dispatch({
          type: "turn.fail",
          turnId: turn.id,
          status: "rate_limited",
          retryAfter: error.retryAfterSeconds,
        });
      } else if (error instanceof StreamStalledError) {
        dispatch({ type: "turn.fail", turnId: turn.id, status: "stalled" });
      } else {
        dispatch({
          type: "turn.fail",
          turnId: turn.id,
          status: "error",
          error: error instanceof Error && error.message.length < 200 ? error.message : s.failed,
        });
      }
    } finally {
      setBusy(false);
      if (loadConsent(storage) === "analytics") {
        reportTiming(timer.finish(turn.modelKey));
      }
    }
  }

  async function decide(turn: Turn, decision: "approve" | "reject") {
    const action = turn.governed?.action;
    if (!action) return;
    dispatch({ type: "approval.resolving", turnId: turn.id });
    try {
      const response = await api.resolveApproval(
        { action, personaId: turn.personaId, policyState: turn.policyState, decision },
        profile.id,
        undefined,
        { conversationId: turn.conversationId ?? thread.id, practice: Boolean(turn.practice) },
      );
      dispatch({
        type: "approval.resolved",
        turnId: turn.id,
        decision,
        result: response.result,
        traceId: response.traceId,
      });
    } catch {
      dispatch({ type: "approval.failed", turnId: turn.id });
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(prompt);
  };

  const resetDemo = () => {
    clearState(storage);
    storage.removeItem(SETTINGS_KEY);
    const personaId = config?.defaultPersona ?? "M-101";
    setSettings({ personaId, modelKey: config?.defaultModel ?? "", policyState: DEFAULT_POLICY });
    dispatch({ type: "reset", id: newId(), personaId, createdAt: now() });
    setPrompt("");
  };

  if (configFailed) {
    return (
      <div className="page">
        <div className="alert error" role="alert">
          {t().errors.config}
        </div>
      </div>
    );
  }

  const earlier = state.threads.filter((item) => item.id !== thread.id && item.turns.length > 0);
  const maxChars = config?.limits.maxPromptChars ?? 500;

  return (
    <div className="demo-layout">
      <aside className="controls" aria-label={s.controls}>
        <details open className="controls-panel">
          <summary>{s.controls}</summary>
          {!config ? (
            <Skeleton lines={6} />
          ) : (
            <>
              <label htmlFor="persona">{s.persona}</label>
              <select
                id="persona"
                value={settings.personaId}
                onChange={(event) => changeContext({ personaId: event.target.value })}
              >
                {config.personas.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {persona && (
                <p className="muted">
                  {s.assigned}: {persona.assignedAccounts.join(", ")}
                </p>
              )}
              <label htmlFor="model">{s.model}</label>
              <select
                id="model"
                value={settings.modelKey}
                onChange={(event) => changeContext({ modelKey: event.target.value })}
              >
                {config.models.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} (deployment: {item.deployment})
                  </option>
                ))}
              </select>
              <fieldset>
                <legend className="visually-hidden">Policy settings</legend>
                {(
                  [
                    ["restrictedMode", s.restricted],
                    ["customerApproved", s.customerApproved],
                    ["adminMode", s.adminMode],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.policyState[key]}
                      onChange={(event) =>
                        changeContext({
                          policyState: { ...settings.policyState, [key]: event.target.checked },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <h2 className="panel-heading">{s.scenarios}</h2>
              <ul className="scenarios">
                {config.scenarios.map((scenario) => (
                  <li key={scenario.prompt}>
                    <button type="button" disabled={busy} onClick={() => void run(scenario.prompt)}>
                      <span>{scenario.prompt}</span>
                      <small>{scenario.expect}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="profile">
            {s.profile}: <strong>{profile.alias}</strong>{" "}
            <button
              type="button"
              className="link"
              onClick={() => setProfile(resetProfile(storage))}
            >
              {s.resetProfile}
            </button>
          </p>
          <p className="muted small">{s.profileNote}</p>
        </details>
      </aside>

      <section className="demo-main">
        <h1>{s.title}</h1>
        <p className="lead">{s.intro}</p>
        <div className={practice ? "mode-bar practice" : "mode-bar"} role="status">
          <span>
            <strong>{practice ? s.practiceOn : s.liveOn}</strong>{" "}
            {practice ? s.practiceExplain : s.liveExplain}
          </span>
          <a className="button" href={practice ? "#/demo" : "#/demo?mode=practice"}>
            {practice ? s.switchToLive : s.switchToPractice}
          </a>
        </div>
        <form className="prompt-form" onSubmit={submit}>
          <label htmlFor="prompt">{s.promptLabel}</label>
          <div className="prompt-row">
            <input
              id="prompt"
              value={prompt}
              maxLength={maxChars}
              placeholder={s.promptPlaceholder}
              autoComplete="off"
              onChange={(event) => setPrompt(event.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || !prompt.trim() || !config}>
              {busy ? s.running : s.send}
            </button>
          </div>
          <p className="muted small">
            {prompt.length}/{maxChars}
          </p>
        </form>

        <div className="chat-toolbar" role="toolbar" aria-label={s.chatActions}>
          <span className="chat-status" aria-live="polite">
            {thread.turns.length === 0 ? s.chatEmpty : s.chatCount(thread.turns.length)}
          </span>
          <button
            type="button"
            onClick={() => startNewThread()}
            disabled={busy || thread.turns.length === 0}
            title={s.newChatHint}
          >
            <span aria-hidden="true">＋ </span>
            {s.newChat}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "thread.clear" })}
            disabled={busy || thread.turns.length === 0}
            title={s.clearChatHint}
          >
            {s.clearChat}
          </button>
          <details className="history-menu">
            <summary>
              {s.history} ({earlier.length})
            </summary>
            <div className="history-panel">
              {earlier.length === 0 ? (
                <p className="muted">{s.historyEmpty}</p>
              ) : (
                <ul className="history">
                  {earlier.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={(event) => {
                          dispatch({ type: "thread.open", id: item.id });
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        {s.openThread}: “{item.turns[0].prompt}” ({item.turns.length})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
          <button
            type="button"
            className="danger"
            onClick={resetDemo}
            disabled={busy}
            title={s.resetDemoHint}
          >
            {s.resetDemo}
          </button>
        </div>

        {thread.turns.length === 0 ? (
          <div className="empty">
            <h2>{s.emptyTitle}</h2>
            <p>{s.emptyBody}</p>
          </div>
        ) : (
          <div className="turns">
            {thread.turns
              .map((turn, index) => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  index={index}
                  onDecision={decide}
                  observability={config?.observability}
                />
              ))
              .reverse()}
          </div>
        )}
      </section>
    </div>
  );
}
