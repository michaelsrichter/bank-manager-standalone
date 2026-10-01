import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  /** `#/demo?mode=practice` opens Practice: no AI model, real policy checks. */
  | { page: "demo"; practice: boolean }
  | { page: "health" }
  /** `#/evaluations?run=<evalId>/<runId>` opens one Foundry evaluation run. */
  | { page: "evaluations"; run: string | null }
  | { page: "privacy" }
  | { page: "terms" }
  | { page: "docs"; doc: string };

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  if (path.startsWith("docs")) {
    const doc = decodeURIComponent(path.slice(5)) || "README.md";
    return { page: "docs", doc };
  }
  if (path === "demo") {
    return { page: "demo", practice: new URLSearchParams(query).get("mode") === "practice" };
  }
  if (path === "evaluations") {
    return { page: "evaluations", run: new URLSearchParams(query).get("run") };
  }
  if (path === "health" || path === "privacy" || path === "terms") {
    return { page: path };
  }
  return { page: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo?.(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
