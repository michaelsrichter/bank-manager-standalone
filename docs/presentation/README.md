# Presentation experience

This folder explains the opt-in presentation routes for the Governed AI Bank Assistant demo. The routes let a presenter run a talk without PowerPoint.

## Talk

| Talk                                                                     | Route                                                                            | Script                                                                                         | Console                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 45-minute session: "Can an AI assistant be trusted with a bank account?" | [/presentation/session](https://bankmanager.eps-demos.site/presentation/session) | [/presentation/session/script](https://bankmanager.eps-demos.site/presentation/session/script) | [/presentation/session/console](https://bankmanager.eps-demos.site/presentation/session/console) |

The session is for architects and technical decision makers who are building multi-agent solutions. The planned talk time is 44 minutes. Questions happen after the talk.

The talk assumes the audience already knows _why_ agents need governance. It focuses on the Microsoft solutions, each shown live. The flow is: Microsoft's stack for governed, trusted agents (one map: build, govern, verify, observe, operate at scale) → the technical stack → a normal governed run → Microsoft Foundry evaluators and real results → how ACS, ASSERT, and the Agent Governance Toolkit fit, with ASSERT's real config → Foundry guardrails versus ACS → breaking the rules on purpose → the three checks and the ACS code → observability (what Microsoft gives you, how it works here, the tracing code, then tracing the $60,000 answer live in Azure Monitor) → securing and running agents at scale with Entra, Defender for Cloud, Purview, and Foundry Control Plane → how to start. The deck does not use a separate trust dashboard.

Every product named in the talk, with links, is in [product-links.md](product-links.md).

## Code on slides

Code slides show **real source lines**, never copies. Mark a region in any source file under `backend/`, `evals/`, `frontend/src/`, `infra/`, `config/`, or the `Dockerfile`:

```python
# tour:begin slide-acs-run-tool
...code...
# tour:end slide-acs-run-tool
```

Use `//` instead of `#` in TypeScript. Then run `npm run tour:sync` in `frontend/`. It writes `frontend/src/presentation/snippets.generated.json` with highlighted code, the file, the line numbers, and a GitHub link to those exact lines. Reference it in `deck.ts` with `{ kind: "snippet", items: [{ id: "slide-acs-run-tool", caption: "..." }] }`. Every snippet shows a **GitHub · file · lines** link, so a technical audience can find the code later. The docs build fails if the JSON is stale, and a test fails if a slide names a snippet that does not exist.

## Observability in the talk

Five slides cover observability. The speaker notes are the script:

1. **Observability: what Microsoft gives you:** Application Insights with OpenTelemetry, Microsoft Foundry tracing, workbooks and alerts, and Foundry Control Plane.
2. **How it works:** one Trace ID from the browser through `invoke_agent`, the model call, then one branch per lane (`lane baseline` and `lane governed`), each ACS check, and each tool, sent with OpenTelemetry and managed identity to Application Insights, Azure Monitor metrics, and Log Analytics.
3. **One answer, two lanes, one trace:** the real span tree for the $60,000 transfer: `lane baseline` ran the tool; `lane governed` stopped at `pre_tool_call`. The code shows how each lane span records its own result.
4. **Tracing in code:** the ACS telemetry sink and the Logs query behind **Both lanes in Logs**, with GitHub links.
5. **Trace an answer in Azure Monitor, lane by lane (live):** in the console, click **Open every answer, both lanes (Logs)** to show every question asked so far with the two lanes side by side. Then open the $60,000 answer's **IDs and observability links** → **Both lanes in Logs** (one row per lane) and **This answer in Logs** (steps grouped Shared → No rules → Governed). `denied_expected` is the policy working; `denied_unexpected` is the engine failing closed and is the one to investigate. Optional: the **Answer review** workbook (paste the Conversation ID) has **No rules** and **Governed** columns.

Telemetry takes 2 to 5 minutes to arrive, so the live step traces an answer from earlier in the talk. Ask one question about 10 minutes before the talk as a backup trace. Details: [observability](../telemetry/observability.md).

## Presenting on one screen

1. Open [/presentation/session](https://bankmanager.eps-demos.site/presentation/session).
2. Select **Presenter details** and add only details you want shown on the title and QR slides.
3. Use the keyboard:
   - Right Arrow or Page Down: next slide.
   - Left Arrow or Page Up: previous slide.
   - Home or End: first or last slide.
   - **N**: speaker notes.
   - **T**: timer.
   - **F**: full screen.
4. Open the live app only when the notes say to do it.

## Presenting with two screens

1. Open [/presentation/session/console](https://bankmanager.eps-demos.site/presentation/session/console).
2. Select **Open Demo Window**. If your browser blocks it, allow pop-ups for this site and try again.
3. Press **F** in the Demo Window for full screen.
4. Share the Demo Window, not the presenter console.
5. Use the console buttons or keys:
   - **S** shows the slide.
   - **D** shows the live site page for that slide.
   - **Q** shows QR codes.
   - **B** or period shows a black screen.
   - Arrow keys or **Space** move between slides. **T** starts or pauses the talk timer.

The console shows what the audience sees now, the next slide, the speaker notes (Say, Do,
Point out, If it breaks), how many minutes the slide should take, and whether you are ahead
or behind. A status pill shows whether the Demo Window is connected and in full screen. If you
reload the console, it picks up where the running Demo Window is, without reloading the
Demo Window (so the live chat is kept).

**Light and dark theme.** The Demo Window always uses the console's theme. Switch the theme
in the console header, and the slides and the live pages inside the Demo Window change too.
Every open page of this site follows the same choice.

The Demo Window can frame only same-site routes from a fixed allow-list: the live demo, Practice backup, Evaluations, health page, governance tour, architecture diagrams, and products and links page. Azure portal pages cannot be framed. On the trace-it-live slide, the console shows **Open every answer, both lanes (Logs)**, **Open Answer review workbook**, **Open Demo overview workbook**, and **Open Application Insights Logs** buttons. They open the portal in its own clean window, which you can then share.

## Presenter details and privacy

Presenter and event details are saved only in this browser by `localStorage`. They are never sent to the demo API. Use **Remove my details** to delete them.

**Your QR code.** Paste your LinkedIn profile, or any web link, into **Your link for a QR code**. The app makes the QR code right in the browser with the open-source [node-qrcode](https://github.com/soldair/node-qrcode) library (MIT license), so no outside QR service sees your link. A preview appears as you type, with a **Download QR code (SVG)** link for other slides. The label under the code fills in by itself (for example, **LinkedIn**), or you can type your own. Links that start with `http://` are upgraded to `https://`. Links with a username or password are refused. The QR code shows on the first and last slides, and full screen when you press **Q**.

## QR codes

The demo QR code is generated locally during the frontend build:

```powershell
cd frontend
node scripts\build-qr.mjs
```

The SVG is committed at `frontend/public/presentation/demo-qr.svg`. A frontend test checks that it still matches `https://bankmanager.eps-demos.site/`. The presenter QR code is drawn in the browser, also without an outside QR service.

## Editing the deck

Slides are typed data in `frontend/src/presentation/deck.ts`. The same deck drives the slides, the printable script, the presenter console, and the Demo Window. Each slide needs:

- a stable ID;
- planned minutes;
- speaker notes;
- fallback notes for live steps;
- launch links that are either HTTPS links or allowed same-site routes.

Keep the total planned time between 85% and 100% of the target time.

## Sources for product facts

Research date: 2026-10-02.

| Fact used in the talk                                                                                                                                                                                 | Source                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Agent Governance Toolkit is open source under MIT, Public Preview, and describes policy enforcement, zero-trust identity, execution sandboxing, and reliability engineering for autonomous AI agents. | <https://github.com/microsoft/agent-governance-toolkit>                                                        |
| Agent Control Specification is the toolkit policy-engine SDK. This demo uses `agent-control-specification` 0.4.0b0 alpha, built from a pinned commit, with OPA running Rego.                          | Repository configuration and <https://github.com/microsoft/agent-governance-toolkit>                           |
| ACS is vendored into AGT under `policy-engine/` as its policy layer (Public Preview). Verdicts are allow, warn, deny, escalate, and transform.                                                        | <https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/packages/agent-control-specification.md> |
| ASSERT is open source (MIT). `assert-ai` 0.3.0 turns written behaviors into generated tests scored by a judge. Its guided workflow is Clarity (find risks), ASSERT (measure), ACS (govern).           | <https://github.com/responsibleai/ASSERT>                                                                      |
| Microsoft Foundry built-in evaluator families: general purpose, textual similarity, RAG, risk and safety, agent, rubric, Azure OpenAI graders, and custom. Some are preview.                          | <https://learn.microsoft.com/azure/foundry/concepts/built-in-evaluators>                                       |
| Microsoft Foundry tracing is generally available for prompt and hosted agents. Workflow and external agents are in preview.                                                                           | <https://learn.microsoft.com/azure/foundry/observability/how-to/trace-agent-setup>                             |
| Foundry agent evaluation is public preview. Model and dataset evaluation APIs are generally available.                                                                                                | <https://learn.microsoft.com/azure/foundry-classic/how-to/develop/agent-evaluate-sdk>                          |
| OpenTelemetry GenAI semantic conventions are in Development status.                                                                                                                                   | <https://opentelemetry.io/docs/specs/semconv/gen-ai/>                                                          |
| Monthly and per-request cost numbers come from this repository's cost page.                                                                                                                           | [cost-to-run.md](../cost/cost-to-run.md)                                                                       |
