import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "demo" }
  | { page: "health" }
  | { page: "privacy" }
  | { page: "terms" }
  | { page: "docs"; doc: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path.startsWith("docs")) {
    const doc = decodeURIComponent(path.slice(5)) || "README.md";
    return { page: "docs", doc };
  }
  if (path === "demo" || path === "health" || path === "privacy" || path === "terms") {
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
