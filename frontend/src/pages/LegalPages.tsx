export function PrivacyPage() {
  return (
    <article className="page prose">
      <h1>Privacy notice</h1>
      <p className="lead">This demo does not collect personal information.</p>
      <ul>
        <li>
          <strong>No PII.</strong> We never ask for your name, email, phone, or address.
        </li>
        <li>
          <strong>Stored only in your browser:</strong> a random nickname (like “Calm Otter 4821”),
          a random ID, your theme, your cookie choice, up to 10 demo chats, and any presenter
          details you type for the slides. Presenter details stay on this device and are never sent
          to the demo services. Use <em>Reset demo</em> or <em>Reset profile</em> on the demo page
          to delete demo data, and <em>Remove my details</em> in the slides to delete presenter
          details.
        </li>
        <li>
          <strong>Sent to the server:</strong> the request you type, the persona and settings you
          chose, and the random ID. The random ID is only used to share rate limits fairly. It is
          not a login and is never stored on the server.
        </li>
        <li>
          <strong>Not logged:</strong> the text you type, the tool results, and account data are
          never written to logs or telemetry.
        </li>
        <li>
          <strong>Analytics are anonymous and opt-in.</strong> If you allow them, we count which
          page was opened (for example “demo”). Operational data such as model name, token counts,
          timing, and policy decisions is recorded in Azure Application Insights for 30 days.
        </li>
        <li>
          Requests are processed by Azure OpenAI in Microsoft Foundry. Microsoft does not use this
          data to train models. See{" "}
          <a
            href="https://learn.microsoft.com/legal/cognitive-services/openai/data-privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Azure OpenAI data privacy
          </a>
          .
        </li>
      </ul>
      <p>
        Details: <a href="#/docs/security/privacy.md">privacy</a> and{" "}
        <a href="#/docs/telemetry/events.md">telemetry events</a>.
      </p>
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="page prose">
      <h1>Terms of use</h1>
      <p className="lead">
        This is a demonstration. Not for production use. No warranty. Provided as-is. Not an
        official Microsoft product.
      </p>
      <ul>
        <li>All people, accounts, balances, and identifiers are fictional.</li>
        <li>No real money moves and no real bank system is connected.</li>
        <li>Do not enter real personal or financial information.</li>
        <li>The source code is available under the MIT License.</li>
      </ul>
    </article>
  );
}
