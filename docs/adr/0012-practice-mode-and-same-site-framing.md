# ADR 0012: Practice mode and same-site framing

- Status: accepted
- Date: 2026-10-01
- Context: The template's new skills ask for two things this app did not have.
  `eps-demo-presentation` runs the live demo inside a **Demo Window** frame next to
  the slides, but the app sent `X-Frame-Options: DENY` and `frame-ancestors 'none'`,
  so it could not frame itself. `eps-demo-observability` asks every request to say
  whether it was a real (live) run, and a presenter needs a safe backup when the AI
  model is slow or busy during a talk.
- Decision:
  - Allow framing by **this site only**: `frame-ancestors 'self'`, `frame-src 'self'`,
    and `X-Frame-Options: SAMEORIGIN`. Other sites still cannot frame the demo.
  - Add **practice mode** (`#/demo?mode=practice`). The browser sends
    `X-Demo-Mode: practice`, and the server answers from the saved examples in
    `backend/tests/fixtures/ai/intents.json` and simple keyword rules instead of calling the AI model. The policy checks still run for
    real. Answers are marked "Practice (not live)", get no observability links, and
    every span carries `demo.mode=practice`.
- Consequences:
  - Good: the presentation can show the real app in a frame, and a presenter can switch
    to practice in one click if the model has a problem.
  - Good: dashboards can separate live runs from practice runs.
  - Bad: a same-site page could frame another page of this site. There is no
    user-specific state to steal (no sign-in, synthetic data), so the clickjacking risk
    is low. Tracked in `docs/security/threat-model.md`.
  - Bad: practice answers only cover the saved examples and a few simple keyword
    rules, so free-form questions may get a less accurate tool choice than the live
    model would make.
