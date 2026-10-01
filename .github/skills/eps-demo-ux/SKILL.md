---
name: eps-demo-ux
description: UX, accessibility, performance, and visible-quality standards for EPS AI vibe demos. Use when building UI, reviewing pages, or auditing front-end quality.
---

# EPS Demo — UX Standards

## Public language and learning

- Public UI **must** be understandable to high-school students and people whose first language is not English. Assume no prior knowledge of AI infrastructure.
- Use short, literal sentences. Aim for 20 words or fewer in first-screen explanations. Use ordinary everyday examples from the demo's domain.
- Explain the task, what the visitor can do, and what the result means before naming technology.
- Prefer everyday words such as "assistant" or "job", "allowed files", "country rules", "outside connection", "saved result" or "source", "steps", "answer", "safety check", "personal details", "repeatable", and "activity".
- Do not lead with unexplained specialist terms such as principal, governance, DLS/FLS, jurisdiction, egress, provenance, orchestration, inference, RAI, PII, deterministic, or telemetry.
- Use clear action labels, usually 1–4 words. Avoid idioms, culture-specific examples, patronizing language, "magic", and claims that a system is completely safe.
- Explain abstract security controls with a concrete example. For example, explain a prompt-injection attack this way: a note inside a delivery box cannot give permission to send private company files.
- Keep warnings about made-up data and extra access visible. Mark ready, partly ready, and planned features honestly. "Set up" does not mean "working".
- Keep technical names, IDs, probes, routes, and model attribution available in closed-by-default **Technical details** or **How it is built** disclosures. Preserve their debugging value.
- Technical reference material in root `/docs` keeps its depth and exact terms, but still follows `eps-demo-plain-language`. All UI help text, tooltips, labels, and error messages also follow `eps-demo-plain-language`.

## Practice and recorded results

- Label an illustrative fixture mode **Practice**. Its answers, counts, model data, and costs are examples, not measurements from earlier live runs.
- Use **Saved result - not live** only for a genuinely recorded result. Keep the capture time and original run details available when present.
- A recorded result describes that earlier run. It does not prove that services work now or that every harmful request will be blocked.
- Keep machine mode values such as `replay` unchanged when correcting public labels. A technical identifier does not decide whether output is illustrative or recorded.
- Never silently replace a failed live request with Practice or a recorded result. Explain the failure and let the visitor choose another mode.
- Read model display names from configuration. Do not add outdated qualifiers. Keep exact model attribution in optional technical details.

## Layout & responsiveness

- Reactive front end, **optimized for desktop landscape**.
- Renders cleanly and **completely** on mobile portrait — no clipped content, no horizontal scroll.
- Dark / light mode toggle in the header.
- For demos with a non-obvious scenario, separate a plain-language Home/About
  narrative, the live demo, and operational health. Link them from desktop and
  mobile navigation.
- Keep secondary information such as history and enforced context in compact,
  collapsed panels when it would displace the primary journey.

## Accessibility

- Standard a11y features (WCAG basics): semantic HTML, keyboard navigation, focus rings, alt text, labeled form fields.
- Color contrast meets WCAG AA.

## Performance

- Performance budget: **FCP < 2s on simulated 4G**, **Lighthouse ≥ 90** on Performance and Accessibility.
- Image assets compressed; no unbounded font/icon downloads.

## Perceived performance & agentic AI streaming

Many of these demos use **agentic AI** that reasons, plans, and calls tools/skills. This takes time and can make the app feel slow or frozen. The UX must make the app feel **alive and working in the background** at every moment.

- **Stream all generative AI to the front end whenever the model/API supports it.** Token-by-token (or chunked) streaming is the default; a blocking request that resolves only when the full answer is ready is an anti-pattern. Fall back to non-streaming only when the underlying service genuinely cannot stream, and say so.
- **Surface safe reasoning summaries or status as it happens.** Use
  provider-authored summaries or observed application progress so the user can
  watch the agent work. Never expose hidden chain-of-thought, and never invent
  completed steps, percentages, or reasoning.
- **Stream tool/skill calls.** When the agent invokes a tool, skill, search, or sub-agent, show it live in plain language (e.g., "Searching allowed files…", "Checking file access…") with progress as steps start and complete. Keep technical tool names and timings in optional details.
- **Always give a sense of progress.** There must be a visible, continuously-updating signal — streamed text, step list, typing indicator, or animated status — so the app never appears frozen during long-running reasoning. If no new event has arrived, say the request is still waiting.
- **Never block the whole UI on a single long AI call.** Keep the interface responsive; reveal partial results progressively as they arrive.
- **Stream gracefully under failure.** If a stream stalls or errors mid-flight, transition to the designed AI failure / timeout state and preserve whatever partial content already arrived.
- When realtime delivery is added, retain an ordered HTTP streaming fallback,
  deduplicate by sequence, and show the active/fallback state honestly.

## Skeleton screens & loaders

- Use **skeleton screens** for initial page/section loads and **skeleton loaders** for content placeholders (cards, lists, product grids, chat bubbles, panels) wherever it makes sense — instead of bare spinners or blank space.
- Skeletons should **match the shape and layout** of the real content they replace, to minimize layout shift (protect CLS) when content arrives.
- Reserve spinners for short, indeterminate waits; prefer skeletons for content that has a known structure.
- Streamed AI responses should render into a skeleton/placeholder that progressively fills in as tokens arrive.

## State, errors, and recovery

- **Reset Demo** button visible whenever the demo mutates state. Clicking it clears local state and returns to a known starting point.
- Stateful chat also provides **New chat** and **Clear current chat** without
  requiring a full reset. Switching agents starts a clean comparison thread,
  while history preserves which agent produced earlier messages.
- **Designed states** (not framework defaults) for:
  - Empty state
  - Loading state (skeleton screens / skeleton loaders, not bare spinners)
  - AI waiting / streaming state (safe summaries, observed steps, tool activity, answer text; no hidden reasoning)
  - AI failure / timeout (including a mid-stream stall)
  - Rate-limited
  - Auth required (if applicable)

## Governance evidence

When identity/data boundaries are part of the story:

- show the agent-to-identity-to-secret/role-to-data flow in simple language;
- show short principal identifiers and safe portal links, never credentials;
- explain matched, returned, result-limit omitted, field-restricted, citation,
  and denial evidence;
- show requested and actual model, token categories, estimate confidence, and
  trace ID, plus the conversation ID, each with a copy button and links into
  Azure Monitor, in a closed-by-default **IDs and observability links**
  disclosure (`eps-demo-telemetry-links`); and
- turn authorized files into an actual browser download through the app. A
  Storage path in answer text is not a download experience.

Long-lived demos add a responsive health page with explicit status semantics,
safe nullable rendering, and a page-level error boundary.

## Internationalization

- Code in an i18n-ready structure (extractable strings, locale wrapper) even if shipped English-only.

## Colophon (mandatory)

Footer must include a colophon block with:

- Last updated date (UTC date is fine)
- Short commit SHA (first 7 chars) linking to the commit on GitHub
- One-line commit message
- A human line: "Last updated **X days ago** — content current as of that date."

The colophon must be generated at build time, not hand-edited.

## Standard footer

- Privacy
- Terms of Service
- About / "How this was built" (links to `/docs/architecture/`)
- Author LinkedIn link(s)
- Link to the GitHub repo when it is public; otherwise link served technical
  documentation that does not require repository access.
- Link to relevant Microsoft product page(s)
- "For demo purposes only" indicator (also visible above the fold)

Use the **same full footer** on every app route and every generated docs page.
Build it from one shared source so pages cannot drift; see `eps-demo-docs`.
Do not shrink it to the smallest existing variant.

## Branding posture

- No partner or customer names on the public site.
- Light shared style (header/footer/color tokens) is encouraged; per-demo hero is allowed and expected.
