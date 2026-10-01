---
name: eps-demo-plain-language
description: Plain-language writing rules for ALL documentation and explanatory text in EPS AI vibe demos. Use whenever you write or edit docs, READMEs, UI help text, tooltips, labels, tutorials, guides, walkthroughs, setup steps, demo scripts, explanatory code comments, or error messages.
---

# EPS Demo — Plain-Language Documentation

Apply these rules to **all documentation and explanatory content**, wherever it
appears:

- Markdown files in `/docs`
- README files
- Documentation inside the application UI
- Help text, tooltips, labels, and instructions
- Tutorials, guides, and walkthroughs
- Setup instructions
- Scripts and demos
- Code comments that explain concepts to the reader
- Error messages and other user-facing explanations
- Any other generated documentation or instructional content

The public-site rules in `eps-demo-ux` and `eps-demo-standards` still apply on
top of these rules. Those rules are stricter for the public UI.

## Who you are writing for

Write for a technically capable person who may **not already know** the
specific technology, architecture, or terms being discussed.

**Assume the reader is smart, not familiar.** Simplify the explanation, not the
technical accuracy. Keep exact names, IDs, commands, API details, and security
reasoning. Explain them instead of removing them.

## Use simple, clear language

Prefer:

- Short, direct sentences
- Common words
- Concrete examples
- Active voice
- Clear cause and effect
- Step-by-step instructions
- Plain English instead of academic or overly technical language

Avoid:

- Corporate jargon
- Fancy words when a simple word works
- Long, complicated sentences
- Abstract explanations when a concrete example would be clearer
- Buzzwords without an explanation
- Assuming the reader already knows a technical term

**The goal is clarity, not sophistication.** Do not make the text sound more
technical than it needs to be.

## Define technical terms

Define every technical term, acronym, architecture concept, Azure service,
programming concept, or other specialist word **the first time you use it** on
a page.

Use a short definition:

> **RPO (Recovery Point Objective)**: The most data you can afford to lose after
> a failure, usually measured in time.

Or explain it in the sentence:

> Azure Functions is a serverless compute service. "Serverless" means you do not
> have to manage the servers yourself.

Do not assume a reader knows an acronym just because experienced engineers use
it often. Terms that usually need a definition include:

API, REST, JWT, OAuth, RBAC, SLA, RTO, RPO, MTTR, idempotency, serverless,
stateless, stateful, event-driven, asynchronous, Infrastructure as Code, CI/CD,
Managed Identity, Private Endpoint, VNet, container, middleware, and dependency
injection.

Demo-specific terms also need a definition the first time they appear. Examples
include a search index, a scoped API key, a role, a hosted agent, a storage
container, a telemetry span, and a practice or replay mode.

## Explain "why," not just "what"

When you document a technical or architecture decision, say **why it exists**
and **what problem it solves**.

Do not write only:

> The application uses Managed Identity for authentication.

Write:

> The application uses Managed Identity to reach Azure resources without storing
> a password or secret in the code. Azure manages the identity for the app.

## Use examples

When a definition alone could be hard to understand, add a small concrete
example.

Prefer:

> An RTO of 30 minutes means the application should be running again within 30
> minutes after a failure.

Instead of:

> RTO represents the maximum tolerable duration of service unavailability.

## Keep it scannable

Use:

- Clear headings
- Short paragraphs
- Bulleted lists
- Numbered steps for procedures
- Tables when they make comparisons easier
- Examples and callouts where they help

Avoid large blocks of dense text.

## Charts, tables, and diagrams

- Label every axis, column, legend entry, and node with words a reader can
  understand without the surrounding text.
- Say what a chart or diagram shows in one sentence before or after it.
- Use one meaning per color or line style, and keep the legend consistent with
  the drawing.
- Do not use an unexplained acronym as the only label.

## Code comments and error messages

- Comment only where the code needs clarification. When a comment explains a
  concept, follow these rules.
- An error message should say what happened, why (if known), and what the reader
  can do next. Example: "Could not reach the search service. Check that the
  endpoint in `.env` is correct, then try again."
- Keep the exact error code or raw detail available for debugging, in a
  technical-details section or log, not as the only message.

## Final check before you finish

Ask yourself:

1. Could someone unfamiliar with this technology understand this?
2. Did I define important acronyms and specialist terms?
3. Did I explain why something is done, where that helps?
4. Could any sentence be shorter or clearer?
5. Did I use a concrete example where an abstract explanation could confuse?
6. Did I avoid unnecessary jargon and corporate language?

If any answer is "no," simplify the text before you finish.
