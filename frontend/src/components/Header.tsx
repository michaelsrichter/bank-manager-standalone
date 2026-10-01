import { useState } from "react";
import { t } from "../i18n";
import type { Route } from "../lib/router";
import type { Theme } from "../lib/preferences";

interface Props {
  route: Route;
  theme: Theme;
  onToggleTheme: () => void;
}

const TOUR_DOC = "governance-tour.md";

const LINKS: {
  href: string;
  key: "home" | "demo" | "evaluations" | "health" | "tour" | "docs";
  isCurrent: (route: Route) => boolean;
}[] = [
  { href: "#/", key: "home", isCurrent: (r) => r.page === "home" },
  { href: "#/demo", key: "demo", isCurrent: (r) => r.page === "demo" },
  { href: "#/evaluations", key: "evaluations", isCurrent: (r) => r.page === "evaluations" },
  { href: "#/health", key: "health", isCurrent: (r) => r.page === "health" },
  {
    href: `#/docs/${TOUR_DOC}`,
    key: "tour",
    isCurrent: (r) => r.page === "docs" && r.doc === TOUR_DOC,
  },
  {
    href: "#/docs/README.md",
    key: "docs",
    isCurrent: (r) => r.page === "docs" && r.doc !== TOUR_DOC,
  },
];

export function Header({ route, theme, onToggleTheme }: Props) {
  const s = t();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        {s.skipToContent}
      </a>
      <div className="header-row">
        <a className="brand" href="#/">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>{s.appName}</span>
        </a>
        <span className="demo-badge" role="note">
          {s.demoOnly}
        </span>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {s.nav.menu}
        </button>
        <nav id="site-nav" className={open ? "site-nav open" : "site-nav"} aria-label="Main">
          {LINKS.map((link) => (
            <a
              key={link.key}
              href={link.href}
              aria-current={link.isCurrent(route) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {s.nav[link.key]}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? s.theme.toLight : s.theme.toDark}
          title={theme === "dark" ? s.theme.toLight : s.theme.toDark}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
}
