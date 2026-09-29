import { useCallback, useEffect, useState } from "react";
import { Skeleton, StatusBadge } from "../components/Skeleton";
import { t } from "../i18n";
import { getHealth } from "../lib/api";
import { formatTime } from "../lib/format";
import type { HealthSnapshot } from "../lib/types";

const POLL_MS = 60_000;

export function HealthPage({ load = getHealth }: { load?: () => Promise<HealthSnapshot> }) {
  const s = t().health;
  const [data, setData] = useState<HealthSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => clearInterval(timer);
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const components = Array.isArray(data?.components) ? data.components : [];
  return (
    <article className="page">
      <h1>{s.title}</h1>
      <p className="lead">{s.intro}</p>
      {failed && (
        <div className="alert error" role="alert">
          {s.error}
        </div>
      )}
      {!data && !failed && <Skeleton lines={4} label={s.loading} />}
      {data && (
        <>
          <p className="health-overall">
            {s.overall}: <StatusBadge status={data.status ?? "unknown"} /> · {s.checkedAt}{" "}
            {formatTime(data.checkedAt)}{" "}
            <button type="button" onClick={() => void refresh()}>
              {s.refresh}
            </button>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{s.component}</th>
                  <th scope="col">{s.status}</th>
                  <th scope="col">{s.detail}</th>
                </tr>
              </thead>
              <tbody>
                {components.map((component, index) => (
                  <tr key={`${component?.name ?? "component"}-${index}`}>
                    <td>
                      {component?.name ?? "—"}
                      {component?.critical ? " *" : ""}
                    </td>
                    <td>
                      <StatusBadge status={component?.status ?? "unknown"} />
                    </td>
                    <td>{component?.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">* Required for the demo to be ready.</p>
        </>
      )}
      <h2>{s.legendTitle}</h2>
      <dl className="glossary">
        {Object.entries(s.legend).map(([key, text]) => (
          <div key={key}>
            <dt>
              <StatusBadge status={key} />
            </dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
