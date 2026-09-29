# Privacy and synthetic data

## In plain language

We never ask who you are. What you type is used once to get an answer and is
not saved on the server. Everything about “customers” in this demo is made up.

## What is stored

| Data | Where | How long | Identifies you? |
|---|---|---|---|
| Random alias + random GUID | Browser `localStorage` | Until “Reset profile” | No |
| Theme, cookie choice, settings | Browser `localStorage` | Until cleared | No |
| Up to 10 chats × 20 turns | Browser `localStorage` | Until “Reset demo” / “Clear current chat” | No |
| Operational telemetry (see [events](../telemetry/events.md)) | Application Insights | 30 days | No |
| Prompts, tool results, account data | **Not stored** on the server | — | — |

- **No PII is collected.** No name, email, phone, or address fields exist.
- **Cookie banner:** strictly-necessary storage by default. Anonymous page-view
  analytics are sent only after the visitor opts in.
- Azure OpenAI does not use customer prompts to train models
  ([data privacy](https://learn.microsoft.com/legal/cognitive-services/openai/data-privacy)).

## Synthetic data

All data in [`backend/bank_manager/bank/data.py`](../../backend/bank_manager/bank/data.py)
is hand-written fiction:

- Customer names are obvious placeholders (“Alex Placeholder”, “Casey Example”).
- SSN-shaped values use the never-issued `000` area number (e.g., `000-11-1001`).
  They exist only so the intentionally unsafe baseline lane can prove that the
  governed lane redacts them. The governed lane never returns them.
- Personas are fictional first names with role labels.
- Transactions use generic merchant categories.

No real customer data was scraped, imported, or used as a template.
