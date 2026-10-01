# Presentation experience

This folder explains the opt-in presentation routes for the Governed AI Bank Assistant demo. The routes let a presenter run a talk without PowerPoint.

## Talk

| Talk | Route | Script | Console |
|---|---|---|---|
| 45-minute session: "Can an AI assistant be trusted with a bank account?" | [/presentation/session](https://bankmanager.eps-demos.site/presentation/session) | [/presentation/session/script](https://bankmanager.eps-demos.site/presentation/session/script) | [/presentation/session/console](https://bankmanager.eps-demos.site/presentation/session/console) |

The session is for architects and technical decision makers who are building multi-agent solutions. The planned talk time is 44 minutes. Questions happen after the talk.

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
   - Arrow keys move between slides.

The Demo Window can frame only same-site routes from a fixed allow-list: the live demo, Practice backup, health page, governance tour, and architecture diagrams. Azure portal pages cannot be framed, so open portal evidence in its own browser window.

## Presenter details and privacy

Presenter and event details are saved only in this browser by `localStorage`. They are never sent to the demo API. Use **Remove my details** to delete them. The optional presenter QR link must be HTTPS and must not contain a username or password.

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

Research date: 2026-10-01.

| Fact used in the talk | Source |
|---|---|
| Agent Governance Toolkit is open source under MIT, Public Preview, and describes policy enforcement, zero-trust identity, execution sandboxing, and reliability engineering for autonomous AI agents. | <https://github.com/microsoft/agent-governance-toolkit> |
| Agent Control Specification is the toolkit policy-engine SDK. This demo uses `agent-control-specification` 0.4.0b0 alpha, built from a pinned commit, with OPA running Rego. | Repository configuration and <https://github.com/microsoft/agent-governance-toolkit> |
| ASSERT is open source. `assert-ai` 0.3.0 is a YAML-driven safety evaluation pipeline. | <https://github.com/responsibleai/ASSERT> |
| Microsoft Foundry tracing is generally available for prompt and hosted agents. Workflow and external agents are in preview. | <https://learn.microsoft.com/azure/foundry/observability/how-to/trace-agent-setup> |
| Foundry agent evaluation is public preview. Model and dataset evaluation APIs are generally available. | <https://learn.microsoft.com/azure/foundry-classic/how-to/develop/agent-evaluate-sdk> |
| OpenTelemetry GenAI semantic conventions are in Development status. | <https://opentelemetry.io/docs/specs/semconv/gen-ai/> |
| Monthly and per-request cost numbers come from this repository's cost page. | [cost-to-run.md](../cost/cost-to-run.md) |
