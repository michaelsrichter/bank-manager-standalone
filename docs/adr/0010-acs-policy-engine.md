# ADR 0010: Agent Control Specification + OPA as the policy engine

- Status: accepted
- Date: 2026-09-29
- Context: The demo’s purpose is to show deterministic, auditable governance of
  AI tool calls. Prompt instructions alone cannot enforce authorization.
- Decision: Keep the upstream design: the Agent Control Specification (ACS)
  runtime from the Agent Governance Toolkit (built from pinned commit
  `c07577d9…`) evaluates `input`, `pre_tool_call`, and `post_tool_call`
  intervention points against Rego rules in `backend/governance/policy/`,
  executed by a pinned, checksum-verified OPA binary.
- Consequences:
  - Good: policy is data, versioned, and unit-tested (`opa test`, pytest).
  - Good: supports allow / deny / escalate (human approval) / transform (redact).
  - Bad: ACS is not on PyPI; builds need Rust. Mitigated by `make install`,
    the devcontainer, CI caching, and the multi-stage Dockerfile.
  - Bad: the manifest’s LLM/classifier annotators are simulated by deterministic
    host rules (documented gap in the threat model).
