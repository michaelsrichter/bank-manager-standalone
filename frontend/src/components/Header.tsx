import { useState } from "react";
import { t } from "../i18n";
import type { Route } from "../lib/router";
import type { Theme } from "../lib/preferences";

interface Props {
  route: Route;
  theme: Theme;
  onToggleTheme: () => void;
}

const LINKS: { page: Route["page"]; href: string; key: "home" | "demo" | "health" | "docs" }[] = [
  { page: "home", href: "#/", key: "home" },
  { page: "demo", href: "#/demo", key: "demo" },
  { page: "health", href: "#/health", key: "health" },
  { page: "docs", href: "#/docs/README.md", key: "docs" },
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
              aria-current={route.page === link.page ? "page" : undefined}
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
