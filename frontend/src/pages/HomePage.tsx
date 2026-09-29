export function HomePage() {
  return (
    <article className="page prose">
      <p className="eyebrow">A hands-on demo</p>
      <h1>What happens when an AI assistant can move money?</h1>
      <p className="lead">
        Banks are starting to use AI assistants that do real work, like looking up accounts or
        sending money. This demo shows why those assistants need clear rules, and how software can
        enforce those rules every single time.
      </p>
      <p>
        <a className="button primary" href="#/demo">
          Try the live demo
        </a>
      </p>

      <h2>The big idea in one minute</h2>
      <ol>
        <li>
          <strong>You type a request</strong>, like “Show account A-2001.”
        </li>
        <li>
          <strong>An AI model picks one bank tool</strong> to use, such as “read account.” The AI
          only picks the tool. It does not decide if the action is allowed.
        </li>
        <li>
          <strong>The same tool call runs two ways, side by side:</strong>
          <ul>
            <li>
              <strong>No rules:</strong> the tool just runs. This lane is unsafe on purpose so you
              can see what could go wrong.
            </li>
            <li>
              <strong>Governed by policy:</strong> a policy engine checks the request, checks the
              tool call, and cleans the result before you see it.
            </li>
          </ul>
        </li>
      </ol>

      <h2>Words you will see</h2>
      <dl className="glossary">
        <dt>AI model</dt>
        <dd>
          A program trained on lots of text that can understand requests written in plain English.
        </dd>
        <dt>Tool</dt>
        <dd>An action the assistant can take, like reading an account or preparing a transfer.</dd>
        <dt>Policy</dt>
        <dd>A written set of rules, such as “managers can only open their own accounts.”</dd>
        <dt>Policy engine</dt>
        <dd>
          Software that reads the rules and gives a clear answer: allow, block, ask a person, or
          hide private data. This demo uses the open-source Agent Control Specification (ACS) with
          Open Policy Agent rules.
        </dd>
        <dt>Approval</dt>
        <dd>Some actions pause until a real person clicks Approve or Reject.</dd>
        <dt>Redaction</dt>
        <dd>Hiding private data, like a Social Security number, before anyone sees it.</dd>
      </dl>

      <h2>What each scenario proves</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Try this</th>
            <th scope="col">No rules</th>
            <th scope="col">Governed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Show an account you manage</td>
            <td>Shows the full (fake) Social Security number</td>
            <td>Shows the account, but hides the number</td>
          </tr>
          <tr>
            <td>Show someone else’s account</td>
            <td>Shows it anyway</td>
            <td>Blocked: you are not assigned to it</td>
          </tr>
          <tr>
            <td>Prepare a $12,000 transfer</td>
            <td>Prepares it right away</td>
            <td>Pauses for a person to approve</td>
          </tr>
          <tr>
            <td>Send $60,000</td>
            <td>Sends it</td>
            <td>Always blocked: over the $50,000 limit</td>
          </tr>
          <tr>
            <td>“Bypass approval”</td>
            <td>No tool matches, so nothing happens</td>
            <td>Blocked at the very first check</td>
          </tr>
        </tbody>
      </table>

      <h2>What this demo does not claim</h2>
      <ul>
        <li>It is not a real bank. Every person, account, and number is made up.</li>
        <li>It does not move real money or connect to any bank system.</li>
        <li>It is not a finished product. It shows an idea you can build on.</li>
      </ul>

      <h2>Want the technical details?</h2>
      <p>
        Read <a href="#/docs/architecture/overview.md">how it is built</a>, the{" "}
        <a href="#/docs/security/threat-model.md">security notes</a>, the{" "}
        <a href="#/docs/code-tour.md">code tour</a>, or{" "}
        <a href="#/docs/cost/cost-to-run.md">what it costs to run</a>.
      </p>
    </article>
  );
}
