import buildInfo from "../generated/build-info.json";
import { t } from "../i18n";
import { daysSince, formatDate, shortSha } from "../lib/format";

export const SITE = {
  repoUrl: "https://github.com/michaelsrichter/bank-manager-standalone",
  upstreamUrl: "https://github.com/tmathew1000/bank-manager-standalone",
  products: [
    { label: "Azure AI Foundry", href: "https://azure.microsoft.com/products/ai-foundry" },
    { label: "Azure Container Apps", href: "https://azure.microsoft.com/products/container-apps" },
    {
      label: "Agent Governance Toolkit",
      href: "https://github.com/microsoft/agent-governance-toolkit",
    },
  ],
};

interface Props {
  info?: { sha: string; date: string; message: string };
  now?: Date;
}

export function Footer({ info = buildInfo, now }: Props) {
  const s = t();
  const sha = shortSha(info.sha);
  const days = daysSince(info.date, now);
  return (
    <footer className="site-footer">
      <p className="demo-note">
        <strong>{s.demoOnly}.</strong> {s.demoOnlyLong}
      </p>
      <nav aria-label="Footer" className="footer-links">
        <a href="#/privacy">{s.footer.privacy}</a>
        <a href="#/terms">{s.footer.terms}</a>
        <a href="#/docs/architecture/overview.md">{s.footer.about}</a>
        <a href={SITE.repoUrl} target="_blank" rel="noopener noreferrer">
          {s.footer.source}
        </a>
      </nav>
      <p className="footer-products">
        {s.footer.products}:{" "}
        {SITE.products.map((product, index) => (
          <span key={product.href}>
            {index > 0 ? " · " : ""}
            <a href={product.href} target="_blank" rel="noopener noreferrer">
              {product.label}
            </a>
          </span>
        ))}
      </p>
      <p className="footer-built">
        <strong>{s.footer.authors}</strong> {s.footer.builtWith}{" "}
        <a href={SITE.upstreamUrl} target="_blank" rel="noopener noreferrer">
          tmathew1000/bank-manager-standalone
        </a>
        .
      </p>
      <p className="colophon" data-testid="colophon">
        {s.footer.lastUpdated} {formatDate(info.date)} ·{" "}
        {sha === "unknown" ? (
          <span>unknown</span>
        ) : (
          <a href={`${SITE.repoUrl}/commit/${info.sha}`} target="_blank" rel="noopener noreferrer">
            <code>{sha}</code>
          </a>
        )}{" "}
        · {info.message}
        <br />
        {s.footer.lastUpdated} <strong>{s.footer.daysAgo(days)}</strong> — {s.footer.current}
      </p>
    </footer>
  );
}
