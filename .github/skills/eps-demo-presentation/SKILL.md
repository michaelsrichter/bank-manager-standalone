---
name: eps-demo-presentation
description: OPT-IN ONLY. Build an in-app presentation experience for a finished EPS demo - talk decks with speaker notes, printable presenter scripts, local QR codes, presenter and event details, and a two-screen presenter mode (a presenter console that drives a toolbar-free Demo Window, like a demo studio). Use only when the user explicitly asks for slides, a talk, a talk track, a presenter script, or a presenter mode, usually after the demo is built and verified. Do not apply it during bootstrap, standards audits, or release reviews of a repo that has no presentation experience.
---

# EPS Demo — Presentation Experience (opt-in)

This skill turns a finished demo into something a person can **present**, right
inside the app, with no PowerPoint. It adds talk decks, speaker notes, a
printable script, QR codes, presenter details, and a two-screen presenter mode.

## When to use this skill

**Opt-in only.** Build it only when the user asks, in words such as "build the
slides," "make a talk track," "add a presenter mode," or "I'm ready to present
this." The usual moment is after the demo is live and verified
(`eps-demo-production-readiness`).

- Do **not** build it during bootstrap (`/new-demo`) or as part of normal
  feature work.
- Do **not** list its absence as a gap in a standards audit or release review.
- You **may** mention it once, after a demo is verified, as an optional next
  step. Then wait for the user to ask.
- When a repo already has a presentation experience, keep it working and apply
  this skill to changes and reviews of it.

## Words used in this skill

- **Deck**: one talk, such as a 15-minute lightning talk or a one-hour session.
- **Slide**: one screen of a deck. **Speaker notes**: what to say, what to
  click, what the audience should notice, and what to do if a step fails.
- **Presenter script**: a printable page with the timing, setup checklist, and
  every slide's notes.
- **Surface**: where the presenter's screen should be for a slide: the slides,
  the demo app, the Azure portal, the Foundry portal, or an observability tool.
- **Presenter console**: the presenter's own screen in two-screen mode, with
  notes, a timer, previews, and controls.
- **Demo Window**: a second, toolbar-free browser window that shows only the
  content. It is shared on a call or shown on the big screen.
- **BroadcastChannel**: a browser feature that lets two pages from the same
  site, in the same browser, send messages to each other. No server is involved.
- **QR code**: a square barcode a phone camera can scan to open a link.

## Before you build: interview

Ask one question at a time. Do not guess the story.

1. Which talk formats, and how long? The default is a **lightning talk**
   (10–15 minutes) and a **one-hour session** (about 50 minutes of content plus
   questions).
2. Who is the audience (business or technical decision makers, architects,
   security teams), and what is the one takeaway?
3. Which screens will be shown live: the app, the Azure portal, the Foundry
   portal, an observability tool, or others?
4. Which product, partner, or program facts must the talk state? Each one needs
   a current, first-party source (see "Content rules").
5. Will the presenter use one screen, or a laptop plus a projector or screen
   share? Two-screen mode helps with both.
6. Should anyone else be able to present? Presenter and event details are typed
   in by each presenter at talk time, so they are never committed.

Restate the plan, the decks, and the slide outline before writing code.

## What to build

| Route | What it is |
|---|---|
| `/presentation` | The talks page: each deck, its length, a QR code, and presenter details |
| `/presentation/<deck>` | The slides, one scrolling page with keyboard paging and a notes drawer |
| `/presentation/<deck>/script` | The printable presenter script |
| `/presentation/<deck>/console` | The presenter console (two-screen mode) |
| `/presentation/<deck>/demo-window` | The Demo Window, opened by the console |

- Link both decks and scripts from the site footer, the one shared footer
  (`eps-demo-ux`, `eps-demo-docs`). Link the console from the talks page and
  from each deck and script.
- Load the presentation code lazily (code splitting), so the demo's own pages
  do not get bigger.
- Make sure the host serves every route. For Azure Static Web Apps, the
  `navigationFallback` rewrite must cover `/presentation/*`.

### Content is data

Write each deck as typed data, not as Markdown or HTML pages. The same content
then drives the slides, the script, the console, and the Demo Window.
[`reference/deck.ts`](reference/deck.ts) has the types:

- A **slide** has a stable `id` (used in `#hash` links), a short `chip` label,
  a title, and blocks such as cards, steps, bullets, a table, a quote, an image,
  a chain of steps, a comparison, a timeline, launch links, an honest "In this
  demo" callout, and the QR block.
- Its **speaker notes** have `minutes`, `surface`, `say`, and optional `do`,
  `watch`, and `fallback` lists.
- Put slides that both decks share in one module. Each deck sets its own order
  and timing.
- Text may use `**bold**`, and nothing else is interpreted
  ([`reference/rich-text.tsx`](reference/rich-text.tsx)). Never render slide or
  presenter text as HTML.

### Slides page

- A top card with the demo QR code, the site address, a clickable list of every
  slide, and links to the script, the other deck, the console, and presenter
  details.
- One full-height section per slide. The address hash follows the current slide,
  so `/presentation/<deck>#cost` opens that slide.
- Keys: → / Page Down next, ← / Page Up back, Home and End, **N** notes,
  **T** timer, **F** full screen. Ignore keys while the presenter types in a
  field or dialog.
- A pager in a corner (Prev, "3 / 12: The idea", Next, Notes).
- A notes drawer: the screen to be on, planned time, a talk timer with "on
  time / ahead / behind," Say, Do, Point out, If it breaks, and the next slide.
  `?notes=1` opens with notes showing.
- Respect reduced motion: no smooth scrolling when the user asks for less motion.

### Presenter script page

The get-ready checklist, the browser tabs to open (with sign-in reminders), a
run-of-show table (slide, screen, start time, length), and every slide's notes.
Add print styles that hide the site chrome. Never show keys, tokens, full
identity IDs, or environment settings on any tab the audience can see.

## Two-screen presenter mode (demo studio)

The presenter sees notes and controls. The audience sees only the demo. This is
the most valuable part of the skill.

- **Open Demo Window** calls `window.open(url, name, 'popup=yes,width=…,height=…')`.
  A pop-up window has almost no browser toolbars. Browsers always keep a small
  address bar for safety, so tell the presenter to press **F** for full screen,
  then share that window or drag it to the projector.
- In Edge and Chrome with two monitors, **Open on other screen** uses the Window
  Management API (`getScreenDetails`) after the browser asks for permission.
  Fall back to the same screen and say so.
- The console sends the Demo Window: a **slide**, a **page of this site** (the
  live demo, a lesson, health), a **QR code**, or a **black screen**. Keys: **S**
  slide, **D** the site page that matches the slide, **Q** QR code, **B** or
  **.** black screen, → and ← slides.
- **The live demo runs inside the Demo Window** in a same-origin `<iframe>`. The
  presenter clicks and types there, and the audience sees exactly that. Keep each
  site page's frame mounted after its first use, and only hide it when you go
  back to slides, so a live chat survives the trip. Offer **Reload page**.
- **Portals cannot be framed.** The Azure portal, Foundry portal, and most
  observability tools refuse to load inside another site. Open them in their own
  clean pop-up window and share that window or the whole screen.
- **Clicker support.** Arrow, Page Up/Down, and period keys pressed in the Demo
  Window are sent to the console as commands, so the console stays in charge.
  Without a console, the Demo Window still works on its own with these keys.
- **Recovery.** The Demo Window sends a heartbeat every 2 seconds. A reloaded
  console waits briefly, then continues from the Demo Window's slide and mode
  instead of jumping to slide 1. **Bring Demo Window forward** never reloads the
  window (it reopens it by name with an empty URL), because a reload would lose
  a live chat.
- **Scaling.** Lay slides out once at 1600 × 900 and scale them to fit
  ([`reference/FitStage.tsx`](reference/FitStage.tsx)). The console shows a
  16:9 preview of the current and next slide.
- Hide the cursor and the small control bar after a few seconds without mouse
  movement. Keep the "for demo purposes only" badge on slides.
- Show clear states for a blocked pop-up and for browsers without
  BroadcastChannel.

Reference: [`reference/show-sync.ts`](reference/show-sync.ts) (messages and
checks), [`reference/PresenterConsole.tsx`](reference/PresenterConsole.tsx),
[`reference/DemoWindow.tsx`](reference/DemoWindow.tsx), and
[`reference/two-screen.css`](reference/two-screen.css).

### Message rules

- One channel per deck: `demo-presentation:<deck id>`.
- Messages: `hello`, `state` (console → window), `heartbeat` and `command`
  (window → console), and `reload-app`.
- **Check every message** before using it: known kinds and sources only, a slide
  number inside the deck, a page from a fixed allow-list of **paths on this
  site**, and presenter details cleaned with the same rules as storage. Never
  accept a full URL, and never run or render message text as HTML.
- Messages never carry secrets, keys, or the presenter key.

## QR codes, drawn locally

Never use an outside QR service. It would see every link the demo encodes, and
it adds a network dependency to a live talk. Use the `qrcode` npm package (MIT
license), which runs in Node.js and in the browser.

- **Demo QR code:** generate it at build time
  ([`reference/build-qr.mjs`](reference/build-qr.mjs)) into
  `public/presentation/`, commit the SVG, and add a test that the committed file
  still matches the configured site address.
- **Presenter QR code:** draw it in the browser
  ([`reference/local-qr.ts`](reference/local-qr.ts)) as an SVG `data:` image.
- Use error correction level M, a 2-module margin, and dark-on-white colors.
  Test by scanning, or by decoding a screenshot.

## Presenter and event details

Any presenter can type, in a dialog on the slides or the talks page:

- name, and job title and company (optional);
- event name (optional) and event date, which shows **today's date** unless the
  presenter picks one;
- an optional **HTTPS** link for their own QR code, with a short caption such as
  "LinkedIn" or "My website."

The title slide shows the event and date prominently, then the presenter and
their QR code. The last slide and the console's **QR code** screen show the demo
QR code and the presenter's side by side, each with a heading.

- Save the details only in the browser's `localStorage`, with **Remove my
  details**. Never commit them, and never send them to the demo's services.
- Clean every field on read, on save, and in every synced message
  ([`reference/presenter-details.ts`](reference/presenter-details.ts)): trim,
  limit the length, accept only real dates, and accept only `https://` links
  without a user name or password. Turn `example.com/me` into
  `https://example.com/me`.
- Update the site's privacy notice to say these details stay in the browser.

## Content rules

- **Plain language** (`eps-demo-plain-language`). Short slide text, and
  conversational notes a presenter can glance at.
- **A tested story arc.** Title → problem → the idea → meet the demo → live
  demo → how it works → proof in the portals → trust and compliance → cost →
  the bigger picture (ecosystem or partnership, when relevant) → takeaway → try
  it (QR codes). The one-hour deck adds an agenda, architecture, deeper demo
  sections, evidence and dashboards, and "how to start."
- **Timing adds up.** Each slide has planned minutes. A test checks that each
  deck's total is between 85% and 100% of its target. Leave time for questions
  in the long deck.
- **Exact live steps.** `do` steps use the UI's exact labels and the demo's
  built-in sample questions. Add a warm-up step to the checklist so the first
  live answer is not a cold start.
- **A fallback for every live step.** Say the safe error out loud, then switch to
  **Practice** and say that you did. Never present Practice as live.
- **Honest callouts.** When the demo skips a production control, such as Private
  Link, say so on the slide with an "In this demo" callout. Never overclaim.
- **Verified facts.** Check product status (generally available or preview),
  regions, awards, and partner claims against current first-party sources. Note
  the research date in the docs. Soften or drop what you cannot verify.
- **Names.** Follow the repo's public-site rules: no customer names, and no
  partner names unless the repo already has an ADR for a partner-branded site.

## Show the evidence

When a slide says "let's see what happened," the presenter should open that
answer in the observability tools in one or two clicks. Use
`eps-demo-telemetry-links` for the "IDs and observability links" panel. Reference
its workbook and links in the notes for the evidence slides.

## Accessibility

Semantic headings per slide, visible focus, keyboard access to every control,
`aria-live` for the slide counter and connection status, alt text for QR codes
("QR code. Scan it to open …"), color contrast that works in dark and light
themes, and readable layouts on a phone (slides stack, no sideways scrolling).

## Testing

- **Content:** unique slide IDs, notes on every slide, timing within target,
  launch links that point only to real routes or HTTPS pages, and any code shown
  on a slide matching the real source.
- **Slides page:** keys move between slides and update the hash, notes open and
  close, keys typed into fields are ignored, and `#slide` deep links open that
  slide.
- **Presenter details:** links that are not HTTPS are refused, real dates only,
  the title slide shows the event and date, and both QR codes appear on the
  QR slide.
- **Two-screen mode:** use a fake in-memory BroadcastChannel. Cover console to
  window state, clicker commands from the window, a reloaded console adopting
  the window's position, a blocked pop-up message, rejected unknown pages and
  messages, and the site-page frame staying loaded between slides.
- **Browser check:** open the console and the Demo Window for real. Go through
  slides, the live site, the QR screen, and the black screen. Reload the console
  mid-talk. Decode both QR codes from a screenshot.

Reference tests: [`reference/presentation.test.ts`](reference/presentation.test.ts).

## Documentation

Fill in [`docs/presentation/`](../../../docs/presentation/README.md): the talks,
how to present (one screen and two screens), the keys, presenter details and
privacy, the QR code build step, how to edit decks, and the sources and research
date for facts stated in the talks. Add the routes to the served docs and to the
footer.

## Release verification

1. Open each deck and script from the footer on the deployed site.
2. Add presenter details with a QR link. The title slide and the QR slide show
   them. Remove them again.
3. Open the console, then the Demo Window. Go through a few slides, show the
   live demo inside the Demo Window, return to slides, and confirm the chat is
   still there.
4. Reload the console. It continues from the Demo Window's slide.
5. Scan the demo QR code and the presenter QR code with a phone.
6. Run the evidence step: open one live answer through
   `eps-demo-telemetry-links`.

## Anti-patterns to refuse

- Building the presentation experience without being asked.
- Outside QR services, or remote fonts and scripts loaded only for the slides.
- Committing a presenter's name, event, or personal link to the repo.
- Rendering slide or presenter text as HTML.
- A Demo Window that loads arbitrary URLs, other sites, or unchecked message
  values.
- Reloading the Demo Window to bring it forward.
- Claims on slides without a current source, or Practice shown as live.
- Separate copies of slide content for the slides, script, and console.

## Reference files

| File | What it is |
|---|---|
| [`reference/deck.ts`](reference/deck.ts) | Deck, slide, and speaker-note types; timing helpers |
| [`reference/rich-text.tsx`](reference/rich-text.tsx) | Safe `**bold**` text |
| [`reference/presenter-details.ts`](reference/presenter-details.ts) | Presenter and event details: checks and browser storage |
| [`reference/local-qr.ts`](reference/local-qr.ts) | Draws a QR code in the browser |
| [`reference/build-qr.mjs`](reference/build-qr.mjs) | Writes the demo QR code at build time |
| [`reference/show-sync.ts`](reference/show-sync.ts) | Console and Demo Window messages, checks, and commands |
| [`reference/PresenterConsole.tsx`](reference/PresenterConsole.tsx) | The presenter console (React) |
| [`reference/DemoWindow.tsx`](reference/DemoWindow.tsx) | The Demo Window (React) |
| [`reference/FitStage.tsx`](reference/FitStage.tsx) | Scales a 1600 × 900 slide to any window |
| [`reference/two-screen.css`](reference/two-screen.css) | Layout rules the two-screen mode depends on |
| [`reference/presentation.test.ts`](reference/presentation.test.ts) | Unit tests to copy |

The reference code is TypeScript and React, the template's default frontend
(`eps-demo-architecture`). It was type-checked in strict mode and its tests pass.
For another stack, keep the same routes, message checks, and behaviors.
