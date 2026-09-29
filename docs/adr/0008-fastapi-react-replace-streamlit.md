# ADR 0008: FastAPI + React replace Streamlit

- Status: accepted
- Date: 2026-09-29
- Context: The upstream repository used a Streamlit app. The EPS standards
  require a cookie banner, dark/light toggle, build-time colophon, served docs,
  designed loading/error/rate-limit states, streamed progress with sequence
  numbers, a health page, keyboard/mobile quality, and FE coverage ≥ 60%.
  Streamlit makes most of these hard or impossible (server-driven reruns,
  WebSocket-only transport, limited control of markup and headers).
- Decision: Replace Streamlit with a FastAPI backend (`backend/`) and a React +
  TypeScript + Vite frontend (`frontend/`), keeping the original ACS manifest,
  Rego policy, tools, and comparison semantics.
- Consequences:
  - Good: meets every UX/compliance rule; testable with pytest and vitest.
  - Good: strict CSP and security headers; same-origin API.
  - Bad: more code than the Streamlit prototype; two toolchains (Python + Node).
