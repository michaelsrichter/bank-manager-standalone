import { useEffect, useState } from "react";
import { CookieBanner } from "./components/CookieBanner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { DemoPage } from "./demo/DemoPage";
import { sendPageView } from "./lib/api";
import {
  loadConsent,
  loadTheme,
  saveConsent,
  saveTheme,
  type Consent,
  type Theme,
} from "./lib/preferences";
import { useRoute } from "./lib/router";
import { DocsPage } from "./pages/DocsPage";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [consent, setConsent] = useState<Consent>(() => loadConsent());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (consent === "analytics") sendPageView(route.page);
  }, [consent, route.page]);

  const choose = (value: "analytics" | "necessary") => {
    saveConsent(value);
    setConsent(value);
  };

  return (
    <>
      <Header
        route={route}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
      />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={route.page}>
          {route.page === "home" && <HomePage />}
          {route.page === "demo" && <DemoPage />}
          {route.page === "health" && <HealthPage />}
          {route.page === "docs" && <DocsPage doc={route.doc} />}
          {route.page === "privacy" && <PrivacyPage />}
          {route.page === "terms" && <TermsPage />}
        </ErrorBoundary>
      </main>
      <Footer />
      {consent === null && <CookieBanner onChoose={choose} />}
    </>
  );
}
