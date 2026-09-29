# ADR 0009: Direct structured output instead of Microsoft Agent Framework

- Status: accepted
- Date: 2026-09-29
- Context: `eps-demo-ai-models` asks for Microsoft Agent Framework for custom
  Foundry agent orchestration unless an ADR approves otherwise. This demo makes
  exactly one model call per request: a structured-output classification into
  one of five tool intents. There is no multi-turn loop, planning, or
  model-driven tool execution; the application — not the model — invokes the
  tool, through ACS.
- Decision: Call Azure OpenAI directly (OpenAI Python SDK, Entra token,
  `beta.chat.completions.parse` with a Pydantic schema) behind an `IntentRouter`
  interface with a deterministic `FakeIntentRouter` for `FAKE_AI=1`.
- Consequences:
  - Good: minimal dependencies; deterministic, testable routing; the model can
    never execute a tool on its own.
  - Good: tool lifecycle is still first-class and visible (streamed steps).
  - Bad: if the demo grows into multi-step agents, adopt Agent Framework and
    wrap its tool calls with ACS (`agent_control_specification.integrations`).
