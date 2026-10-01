---
name: eps-demo-docs
description: Documentation structure standard for EPS AI vibe demos. Use when creating docs, writing READMEs, capturing ADRs, or documenting architecture/security/cost/telemetry.
---

# EPS Demo — Documentation

The **`/docs` folder at the repo root is the single source of truth** for all documentation. The README is a short on-ramp that links into `/docs`.

## Writing style: plain language everywhere

**All documentation follows `eps-demo-plain-language`.** Load it before you
write or edit `/docs`, READMEs, served guides, help text, setup steps, demo
scripts, or explanatory comments.

- Keep the exact terms, architecture, security reasoning, API details, and
  operational depth that technical readers need.
- Use short sentences. Define each term and acronym the first time it appears.
  Explain why a choice was made. Add a concrete example when a definition alone
  could confuse.
- Simplify the explanation, not the accuracy.

## Public explanations and technical reference

Public pages and technical docs have different jobs. Keep both, and link them.

- Public pages, navigation, cards, help text, errors, and action labels
  **must** use plain English for high-school students and people whose first
  language is not English. Follow the public-language rules in `eps-demo-ux`.
- Explain what the visitor can do and what the result means before naming
  products, acronyms, or specialist terms.
- Use one everyday example from the demo's own domain to explain an abstract
  control. Example: "A note inside a delivery box cannot give permission to
  send private company files."
- Put technical names, IDs, probes, routes, model attribution, and
  implementation details in optional **Technical details** or **How it is
  built** disclosures. Do not delete their debugging value.
- Describe observed progress and tool activity only. Never require or expose
  hidden model thinking or chain of thought, including in screenshots and
  walkthroughs.
- Walkthroughs must distinguish **Practice** (illustrative fixtures) from
  **Saved result - not live** (a genuinely recorded run). Practice counts,
  model data, and costs are examples, not measurements.
- Use current configured display names, such as model labels, in public text.
  Keep exact deployment IDs in technical details.
- Link public explanations to the technical reference instead of copying it.

## Required `/docs` structure

```
/docs
├── README.md                # index / map of /docs
├── architecture/
│   ├── overview.md          # what the app does, value, audience
│   ├── diagram.md           # C4 or equivalent diagrams (Mermaid OK)
│   ├── azure-services.md    # what's used and why
│   └── data-flow.md
├── security/
│   ├── threat-model.md
│   ├── auth.md              # chosen identity posture and why
│   ├── secrets.md           # Key Vault, Managed Identity story
│   ├── content-filtering.md
│   ├── rate-limiting.md
│   └── privacy.md           # what is persisted, where, for how long
├── api/                     # optional but recommended
│   └── openapi.yaml
├── cost/
│   ├── cost-to-run.md       # current monthly estimate
│   └── cost-at-scale.md     # how cost changes at 10x/100x usage
├── operations/
│   ├── deploy.md
│   ├── rollback.md
│   └── troubleshooting.md
├── adr/                     # Architecture Decision Records
│   ├── 0001-use-bicep.md
│   ├── 0002-react-vite.md
│   └── ...
├── telemetry/
│   └── events.md            # explicit list of every event the app sends
├── health/
│   └── README.md            # dependency probes, status semantics, caching
├── presentation/            # only when eps-demo-presentation is used (opt-in)
│   └── README.md            # talks, presenting, keys, presenter details, sources
├── code-tour.md              # important request paths with current source excerpts
└── build-journal.md         # decisions, dead ends, what worked (optional)
```

## ADR format (keep it tiny)

```
# ADR NNNN: <title>

- Status: accepted | superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Context: 2–4 sentences
- Decision: 1–2 sentences
- Consequences: bullets — both good and bad
```

## Diagrams

- Mermaid in markdown is preferred (renders on GitHub). Use top-to-bottom
  orientation for architecture/security flows, distinctive colors, and bold,
  readable node labels.
- For richer diagrams use Excalidraw and check the `.excalidraw` file in alongside an exported PNG.
- When docs are served as HTML, convert Mermaid to a static SVG/PNG at build
  time; do not rely on a runtime Mermaid renderer. Verify no raw Mermaid source
  remains in generated pages.
- When an architecture diagram exists in more than one form (for example,
  Mermaid in Markdown and a served SVG), generate every form from **one
  canonical source file**, such as `docs/architecture/topology.json`. Hand
  edits to generated diagrams drift.
- Give every line style and color one meaning, and keep the legend identical
  across forms. Example: if the legend says "dashed gold = cancel path," both
  the Mermaid and SVG versions draw those edges that way.
- Draw what is deployed, not what was temporary. Test-only exceptions,
  one-time access grants, and retired designs do not belong in the
  steady-state diagram.
- Describe boundaries accurately. A managed service reached through a private
  endpoint is not physically inside the virtual network; label the boundary as
  private data-plane access and identity.
- Pair each detailed diagram with a one-paragraph plain-language summary.

## Served documentation

When the repo is private or the audience is nontechnical:

- generate static HTML from canonical Markdown during the application build;
- link Architecture/Network, Security, Code tour, Cost, and Docs home from the
  Home, Demo, and Health footers;
- keep the output responsive and keyboard accessible;
- include official documentation and pricing links for every Azure/external
  service discussed; and
- link the relevant Marketplace/Native ISV offering for partner services.

Write a high-school-readable explanation before technical depth in each key
document. Explain what the component does, why it matters, what proves it works,
and what the demo does not claim.

For private source, embed curated current excerpts in the served code tour. Use
build-time extraction so moved source boundaries fail generation, syntax
highlighting without a public CDN, collapsible/copy controls, and checks that
escaped highlighter markup never renders as text. Never expose credentials or
private configuration in a snippet.

Keep the code tour current:

- Describe the source as it is now, not an earlier or planned design. When a
  design changes, update or remove the old tour section.
- Link each excerpt to its file and explain, in plain words, what the code
  proves (for example, "the database key, not the prompt, blocks this read").
- Update the extraction boundaries in the same change that moves the code, so
  the docs build fails instead of silently showing stale code.

Share one footer and one build stamp:

- Generate the footer for app routes and generated docs pages from **one
  canonical data source or template**. Do not maintain a smaller copy for docs.
- Every surface shows the same branding, demo disclaimer, legal links or
  dialogs, source/docs links, and build commit/date. Stamp the build metadata
  once per release, not per page.
- Test text, link, button-action, and metadata parity across every route and
  generated page on desktop and mobile.

## Telemetry doc

`docs/telemetry/events.md` must enumerate **every event** the app sends, including:

- Event name
- Trigger
- Properties (and whether each property is scrubbed/anonymous)
- Destination (App Insights, Clarity, etc.)

It also lists every custom `demo.*` span attribute and the OpenTelemetry
`gen_ai.*` attributes that dashboards rely on, including
`gen_ai.conversation.id`, and explains where the app shows the trace ID and
conversation ID (`eps-demo-telemetry-links`). `docs/operations/` lists each
Azure Monitor dashboard, the question it answers, and the role needed to open
it, plus the steps to review one answer or one chat. See
`eps-demo-observability`.

## Linking discipline

- The README has exactly one "Documentation" section that links to `/docs/README.md`.
- All other docs live under `/docs`. Don't scatter `CONTRIBUTING-like` files at the root except the standard ones (`CONTRIBUTING.md`, `CODEOWNERS`, `LICENSE`, `SECURITY.md`).
