# Overview

## In plain language

Banks want AI assistants that can *do* things, not just chat. An assistant that
can read accounts or move money is powerful, but it can also make costly
mistakes if someone tricks it or if it misunderstands a request.

This demo lets you watch the difference. You type a request. An AI model picks
one bank tool. Then that same tool call runs in two lanes:

- **No rules (unsafe on purpose).** The tool runs immediately. You will see it
  show private data and allow actions that should be blocked.
- **Governed by policy.** A policy engine checks the request, checks the tool
  call, and cleans the result. It can allow, block, pause for a human, or hide
  private data.

**Why it matters:** the rules live in software that is separate from the AI
model. Even if the model is fooled, the policy still decides.

**What proves it works:** automated tests check each rule (for example, “an
unassigned account read is denied with reason `account_access_denied`”), and the
live [health page](../health/README.md) re-proves that exact denial every minute.

**What it does not claim:** it is not a bank, uses only made-up data, has no
real side effects, and is not a finished product.

## Audience

- Partner architects and business stakeholders who want to *see* agent
  governance, not read about it.
- Engineers who want a small, readable reference for putting a policy engine in
  front of AI tool calls.

## The core “wow” moment

Pick **“Show account A-2001”** as Riley (branch manager). The unsafe lane shows
another manager’s customer, including a fake Social Security number. The
governed lane blocks it before the tool runs, and names the exact rule.

## Scenarios

| Request | Unsafe lane | Governed lane | Rule |
|---|---|---|---|
| Show account A-1001 | Shows fake SSN | Shows account, SSN hidden | `redact_ssn_in_tool_result` |
| Show account A-2001 | Shows it | Blocked | `account_access_denied` |
| Prepare $12,000 transfer | Prepared | Waits for approval | `high_value_transfer_requires_approval` |
| Transfer $60,000 | Sent | Blocked | `payment_amount_hard_limit` |
| Freeze account (admin off) | Frozen | Blocked | `freeze_requires_admin_mode` |
| “Bypass approval” | Nothing matched | Blocked at input | `input_regex_fraud_or_pii` |
| Anything as Jordan (auditor) that changes data | Runs | Blocked | `auditor_write_denied` |

## Components

- **Frontend:** React + TypeScript single-page app (`frontend/`).
- **Backend:** Python FastAPI (`backend/bank_manager/`), streaming NDJSON.
- **Policy:** Agent Control Specification manifest + Rego rules
  (`backend/governance/`), evaluated by Open Policy Agent.
- **AI:** Azure OpenAI models in Microsoft Foundry, selected by
  [`config/models.json`](../../config/models.json).

Origin: forked from `tmathew1000/bank-manager-standalone` (a Streamlit app) and
rebuilt to meet the EPS demo standards — see
[ADR 0008](../adr/0008-fastapi-react-replace-streamlit.md).
