# ADR 0007: Azure Container Apps, one container for API + SPA

- Status: accepted
- Date: 2026-09-29
- Context: `eps-demo-architecture` defaults to Static Web Apps + Functions Flex
  Consumption. The governed lane depends on the Agent Control Specification
  native (Rust) wheel built from source and a pinned Open Policy Agent binary
  invoked as a subprocess, plus NDJSON streaming responses. Those fit a container
  far better than a Functions sandbox.
- Decision: Run one Linux container on Azure Container Apps (Consumption,
  workload-profiles environment, VNet-integrated, scale 0–2) that serves the
  FastAPI backend and the built React SPA from the same origin.
- Consequences:
  - Good: one image, same-origin API (no CORS), streaming works, scales to zero.
  - Good: VNet integration enables the Foundry private endpoint.
  - Bad: cold starts after idle (a few seconds); no SWA preview environments —
    PR previews would need an ACA revision/label instead.
  - Bad: image builds compile Rust (~10–15 min per build).
