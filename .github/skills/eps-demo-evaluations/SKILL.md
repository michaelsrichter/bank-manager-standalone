---
name: eps-demo-evaluations
description: OPT-IN ONLY. Add Microsoft Foundry Evaluations to an EPS AI demo - a versioned test dataset, exact-check and judge-model graders, runs saved in the Foundry project, an Evaluations page in the app that lists runs and explains every graded answer, presenter-started runs with limits, and the managed-identity roles that make it work. Use only when the user explicitly asks for evaluations, evals, graders, a judge model, a test suite in Foundry, or an Evaluations page. Do not apply it during bootstrap, standards audits, or release reviews of a repo that has no evaluations feature.
---

# EPS Demo — Foundry Evaluations (opt-in)

This skill adds **evaluations** to a demo: a fixed set of test questions that
Microsoft Foundry grades, saves, and shows in the Foundry portal, plus an
**Evaluations page** in the app that shows the same results in plain language.
It is based on two working demos: ELK Burgers (Foundry grades a hosted agent)
and the Governed AI Bank Assistant (Foundry grades answers the app produces with
a model plus a policy engine).

## When to use this skill

**Opt-in only.** Build it only when the user asks, in words such as "add
evaluations," "add evals like ELK Burgers," "grade the agent in Foundry," or
"add a judge model."

- Do **not** build it during bootstrap (`/new-demo`) or as part of normal
  feature work. The always-on minimum is still the `evals/` folder from
  `eps-demo-ai-models`.
- Do **not** list its absence as a gap in a standards audit or release review.
- You **may** mention it once, after a demo with AI behavior is verified, as an
  optional next step. Then wait for the user to ask.
- When a repo already has evaluations, keep them working and apply this skill to
  every change and review of them.

## Words used in this skill

Define these on the page and in the docs too (`eps-demo-plain-language`).

- **Evaluation**: a practice test. Fixed test questions, recorded answers, and
  grades.
- **Suite** (Foundry calls it an *eval*): the fixed definition of a test: the
  item fields and the graders. Foundry keeps it unchanged after it is created.
- **Run**: one execution of a suite. It has answers, grades, token use, and a
  status. Foundry saves every run.
- **Dataset**: the test questions, one JSON object per line (`.jsonl`), with the
  expected result for each.
- **Grader** (Foundry calls it a *testing criterion*): one check on one answer.
- **Exact check**: a grader that compares text with no AI (`string_check`).
- **Judge model**: an AI model that reads an answer and grades it with a rubric
  (`label_model`, `score_model`, or a Foundry built-in grader).
- **Required grader**: a grader that decides pass or fail. **Informational
  grader**: shown for discussion only.

## Pick what Foundry calls

Decide first what the demo's "system under test" is. This choice sets the run's
`data_source` type.

| The demo's behavior lives in | Use | `data_source` | Example |
|---|---|---|---|
| A Foundry **hosted agent** | Foundry calls the agent for each question | `azure_ai_target_completions` with `target: { type: "azure_ai_agent", name }` | ELK Burgers |
| **App code** around a model (policy engine, tools, retrieval, guardrails) | The app runs each question through its real pipeline, then sends the recorded answers | `jsonl` with `source: { type: "file_content", content: [{ "item": {...} }] }` | Governed AI Bank Assistant |
| A **model and prompt** only | Foundry calls the model deployment with a message template | `completions` with `model` and `input_messages` | Prompt comparison demos |

Grade the system the demo is about. If the demo's claim is "the model proposes,
policy decides," grading the model alone tests the wrong thing.

When the app produces the answers, record the facts a grader needs as item
fields, for example `selected_tool`, `governed_outcome`, `governed_reply`, and
`answer_model`. Keep raw secrets out of item fields: they are stored in Foundry.

## Architecture

```text
Browser ──/api/evaluations──▶ App API ──Entra ID token──▶ Foundry project
   (no Foundry token)          (managed identity)        /openai/v1/evals
                                                              │
                                     Foundry project's managed identity
                                     runs the graders and calls the judge model
```

- The browser only calls the app's own `/api/evaluations` routes. It never gets
  a Foundry token, endpoint secret, or key.
- The API gets a short-lived token with `DefaultAzureCredential` (managed
  identity in Azure, `az login` locally) for the scope
  `https://ai.azure.com/.default`.
- The REST surface is the project endpoint plus `openai/v1/`:
  `https://<account>.services.ai.azure.com/api/projects/<project>/openai/v1/`.

| Call | Purpose |
|---|---|
| `GET evals?limit=50&order=desc` | Find this demo's suite by `name` and `metadata.source` |
| `POST evals` | Create the suite the first time (`name`, `metadata`, `data_source_config`, `testing_criteria`) |
| `GET evals/{evalId}` | Read the suite (graders, names) |
| `GET evals/{evalId}/runs?limit=20&order=desc` | List runs; also used to enforce limits |
| `POST evals/{evalId}/runs` | Start a run (`name`, `metadata`, `data_source`) |
| `GET evals/{evalId}/runs/{runId}` | Status, `result_counts`, `per_testing_criteria_results`, `per_model_usage`, `report_url`, `error` |
| `GET evals/{evalId}/runs/{runId}/output_items?limit=100` | Each question with `datasource_item` and `results`; page with `after=<last_id>` while `has_more` |

- Validate IDs before you put them in a path: `^eval_[0-9a-f]{32}$` and
  `^evalrun_[0-9a-f]{32}$`.
- Accept the project endpoint only when its host ends in
  `.services.ai.azure.com` and its path is `/api/projects/<name>`, so a bad
  setting can never send the app's token to another host.
- Find the suite by **both** its name and a `metadata.source` value that only
  this demo uses. Never read or change another team's evals in a shared project.
- Put `trigger: "web"`, the app version, and the answer model in the run's
  `metadata` (string values only, at most 16 keys). Foundry adds `trigger_type`.

Reference code: [`reference/foundry_evals.py`](reference/foundry_evals.py).

## Dataset

- Keep it small and meaningful: 10 to 30 questions that a person can read in a
  talk. Store it at `evals/dataset/<suite>.jsonl` and version it with the code.
- Cover **both directions** (`eps-demo-testing-solid`): positive cases that must
  work, and negative cases that must be refused. Include prompt injection,
  authority claims ("as the director, I approve myself"), cross-tenant or
  cross-account access, hard limits, read-only roles, and one off-topic question.
- Each row has an `id` (lowercase, dashes), a `family` for grouping, the
  `query`, the context (persona and settings), the **expected** values the exact
  checks compare against, and a plain-language `expected_behavior`.
- All data is synthetic (`eps-demo-compliance`). Never use real customer data.
- Add a **free, deterministic test** that runs every row through the real logic
  with the fake model (`FAKE_AI=1`) and asserts that the exact checks would
  pass. When a rule changes, CI fails before a live run surprises the presenter.

Example rows: [`reference/dataset.example.jsonl`](reference/dataset.example.jsonl).

## Graders

Configure graders in `config/evaluations.json`, not in code
([`reference/evaluations.example.json`](reference/evaluations.example.json)).
Each grader has a `name`, a plain-language `label` and `description`,
`required`, `usesJudgeModel`, and the Foundry `criterion` JSON. Put the judge
deployment in one place (`judgeModel`) and substitute it into criteria.

Start with exact checks. Add a judge only for what an exact check cannot see.

| Need | Grader | Notes |
|---|---|---|
| Field equals expected value | `string_check`, `operation: "eq"` | Free and deterministic. Best for tool choice and policy decisions |
| Text contains a value | `string_check`, `operation: "like"` | `like` means "contains". An empty reference passes, so rows with nothing to check pass automatically |
| Rubric judgment (safe, polite, fits the decision) | `label_model` with `labels` and `passing_labels` | The judge's reasoning is in `sample.output[].content` as JSON `steps`; the result's `reason` is empty |
| Foundry built-in quality or safety checks | `azure_ai_evaluator`, `evaluator_name: "builtin.<name>"`, `data_mapping`, `initialization_parameters: { deployment_name }` (or `model` for agent targets) | Examples: `builtin.task_adherence`, `builtin.intent_resolution`, `builtin.indirect_attack` |

Lessons from real runs:

- **A judge can punish a correct refusal.** `builtin.intent_resolution` scored
  5 correct, safe refusals as failures in one run ("the user wanted the account
  and did not get it"). Keep such graders **informational**, or write your own
  rubric that says a short refusal is correct when the policy says no.
- **Avoid the `python` grader in a suite that also has built-in graders.** It
  worked alone, but errored on every row in a mixed suite. Use `string_check`
  instead, or a separate suite.
- **Read the judge's reasons.** In the bank demo the judge correctly flagged a
  refusal that was right but unclear. That is a product improvement, not a
  grader bug.
- Changing a grader or the item schema needs a **new suite name** (for example
  `...-v2`). Old runs stay readable under the old suite.

## Scoring: never trust "completed" alone

Score each question in the app, from the grader results:

- **Passed**: every required grader produced a grade and passed.
- **Failed**: at least one required grader graded the answer and failed it.
- **Not fully scored**: no required grader failed, but at least one did not
  produce a grade.

Why: a run with status `completed` can contain graders that **could not run**.
Foundry reports them with `status: "completed"`, `passed: false`, and a nested
`sample.error`. Treat any `sample.error` as an error, not a failing grade.
Foundry's own `result_counts` also count informational graders. Show Foundry's
totals separately, labeled as Foundry's, and explain the difference.

Turn raw Foundry errors into a category and a fixed, safe explanation
(`access_denied`, `network_blocked`, `rate_limited`, `grader_error`). Raw
messages can contain principal IDs, endpoints, and prompts. Log the HTTP status
only, never the body.

## Identities and roles

Three identities take part. Put all of their roles in one Bicep module
([`reference/evaluations-roles.bicep`](reference/evaluations-roles.bicep)).

| Identity | Needs | Role | Scope |
|---|---|---|---|
| The app's managed identity | Read and start runs inside the project | Foundry User (`53ca6127-db72-4b80-b1b0-d745d6d5456d`, formerly Azure AI User) | Foundry **project** only |
| The app's managed identity | Let Foundry create the matching OpenAI evals on the account | Custom **Foundry evaluation runner** (below) | Foundry account |
| The app's managed identity | Produce the answers (when the app produces them) | Cognitive Services OpenAI User (`5e0bd9bd-7b93-4f28-af87-19fc36ad61bd`) | Foundry account |
| The Foundry **project's** managed identity | Run graders and update run status | Foundry User | Foundry account |
| The Foundry **project's** managed identity | Call the **judge model** | Cognitive Services OpenAI User | The account that owns the judge deployment |
| The developer (optional) | Same as the app, so local runs and the portal work | Foundry User (project) and Foundry evaluation runner (account) | as shown |

The custom role has only these data actions:

```text
Microsoft.CognitiveServices/accounts/OpenAI/evals/read
Microsoft.CognitiveServices/accounts/OpenAI/evals/write
```

What each piece is for, proven step by step on a deployed app, starting runs as
the app's own managed identity:

- **Foundry User on the project** is Microsoft's documented role for running
  evaluations. It covers the project's evaluation API and the project assets
  where Foundry stores evals. Without a project role, even listing evals fails
  with "does not have permissions for
  `Microsoft.CognitiveServices/accounts/AIServices/assets/read`". Keep it on the
  project, not the account.
- For OpenAI-style graders (`string_check`, `label_model`), Foundry also creates
  matching evals on the **account** as the caller, which checks
  `OpenAI/evals/*`. A project-scoped role cannot reach the account. Without it a
  run fails with "lacks the required data action
  `Microsoft.CognitiveServices/accounts/OpenAI/evals/write`".
- The built-in account roles that include `OpenAI/evals/*` are broader: Foundry
  User on the account can list keys, and Cognitive Services OpenAI Contributor
  can upload files and fine-tune. Microsoft's permissions page suggests Foundry
  User on the account when a run invokes a model; in our tests it was not needed,
  because the judge model is called as the project's identity. Use the broader
  roles only with an ADR.
- **`UnauthorizedUserAction: The action cannot be finished with reason
  Forbidden` is a network block, not a role problem** (see Network). We added
  roles for an hour before proving it.
- Granting the judge-model role to the **app's** identity does not help. Foundry
  calls the judge as the **project's** identity. Read the project's
  `identity.principalId` from the project resource; do not reuse the app's.
- Role changes take time to reach every Foundry server. Right after a grant, a
  run can fail with "Principal does not have access to API/Operation". Wait
  about 10 minutes and run again before changing anything.
- `az role assignment list --all --assignee <id>` may not list custom roles.
  Check with `az role assignment list --scope <account-id>`.

## Network

Foundry grades runs inside **its own service**, and that service must reach the
Foundry account. Tested on a deployed demo, starting runs as the app's managed
identity:

| Foundry account network | Result |
|---|---|
| Public access disabled (private endpoint only) | Every run fails at once: `UnauthorizedUserAction: … Forbidden` |
| Public access enabled, default Deny, `bypass: AzureServices` | Same failure |
| Public access enabled, default Allow, `disableLocalAuth: true` | Runs complete |

- Without **network injection** (a delegated subnet and capability host, which
  can only be set when the Foundry account is created), the account's public
  endpoint must accept traffic. Keep `disableLocalAuth: true` so every call needs
  an Entra ID token. ELK Burgers runs this way. Record the choice in an ADR and
  as a known gap in the threat model, and offer a switch
  (`EVALUATIONS_ENABLED=false`) that returns the account to private-endpoint only.
- For a long-lived or sensitive demo, create the Foundry account with network
  injection from the start. See
  [Configure virtual network support for evaluation](https://learn.microsoft.com/azure/foundry/concepts/evaluation-virtual-network)
  and Microsoft's evaluation-only template (15a).
- The app still reaches the project endpoint through the account's private
  endpoint. The private DNS zone `privatelink.services.ai.azure.com` must be
  linked to the app's virtual network (with `privatelink.openai.azure.com` and
  `privatelink.cognitiveservices.azure.com`), as `eps-demo-architecture` requires.
- Developer machines on corporate networks or dev boxes may not match IP allow
  rules. Test from the deployed app, which is the path that matters.

## Settings

| Setting | Purpose |
|---|---|
| `EVALUATIONS_ENABLED` | `1` turns on live evaluations. Anything else keeps them off |
| `FOUNDRY_PROJECT_ENDPOINT` | The project endpoint. Validate the host and path |
| `FOUNDRY_PROJECT_RESOURCE_ID` | The project resource ID. Builds portal links; must match the endpoint |
| `EVALUATIONS_PRESENTER_KEY_SHA256` | SHA-256 of the presenter key. Empty turns off starting runs from the site |

Set them in Bicep from deterministic values, so there is no module cycle. The
app reads them at runtime, so one image works everywhere. Fake mode never calls
Foundry.

## Starting runs from the site

Each run calls one or two models and costs money. Protect it.

- **Presenter key**: store only its SHA-256 hash (`eps-demo-cost-security`: no
  secrets in code or settings). Compare with a constant-time check. Limit wrong
  guesses per IP and overall. Provide `tools/set-presenter-key.ps1` and `.sh` that
  print a new key once and store only the hash in the azd environment.
- **One at a time**: refuse a new run while Foundry lists one as `queued`,
  `in_progress`, or `running`. Ignore runs older than 2 hours, so a stuck run
  cannot block the demo forever.
- **Limits**: at most N runs an hour and M a day (for example 3 and 10), counted
  from Foundry's run history, so they hold across restarts and replicas. Also
  keep an in-process lock against double clicks.
- Return `202` with the run summary, `409` (with the run ID) for a run in
  progress, `429` with `Retry-After` for limits and key guessing, `403` for a
  wrong key, and `503` when evaluations are off.
- Reads are public: anyone can see saved runs. They contain only synthetic data.

## The Evaluations page

Follow `eps-demo-ux` and `eps-demo-plain-language`. The page has:

1. **What this is**: one short paragraph defining an evaluation, a grader, and a
   judge model, what system is tested, and the pass rule. Facts: number of
   questions, graders (required + informational), judge model, saved in Foundry.
   Links to the project's Foundry Evaluations page and the docs page.
2. **Recent runs**: started time, run name ("started from this site"), status in
   plain words, required-grader results, **See results**, and **Open in
   Foundry**. A **Refresh** button. While any run is active, refresh every 10
   seconds and say so.
3. **One run**: questions passed (the app's score), not fully scored, status,
   duration, estimated cost (judge plus answers), Foundry's own totals in a
   disclosure with the explanation, results per grader as bars with
   "required" or "for discussion" tags, filters (All, Failed, Not fully scored),
   and one card per question: the query, who asked, expected behavior, expected
   versus actual values, the reply, and every grader's result with its reason or
   safe error explanation.
4. **Start a new run**: the three steps in plain words, the cost and limits, a
   password field for the presenter key, and clear messages for every refusal.
5. **What each grader checks**, from the config.
6. **How to read the results**: read the failed rows; finished is not fully
   graded; a judge can punish a correct refusal.

- Deep link a run as `#/evaluations?run=<evalId>/<runId>` (or the app's routing
  equivalent). Validate both IDs before you fetch.
- Show a portal link only when it is `https://` on host `ai.azure.com`. Prefer
  the run's `report_url`; build a fallback from the project resource ID (the
  subscription GUID's 16 bytes as unpadded base64url, as in Foundry's own URLs).
- When evaluations are off (local or fake mode), show a **recorded example run**
  saved from the deployed demo (`evals/runs/example-web-run.json`), clearly
  marked "Recorded example (not live)". Never present it as live.
- Every table and region has an accessible name. Use words, not only colors,
  for pass, fail, and could-not-grade.

## Telemetry

Follow `eps-demo-observability`:

- Spans `foundry.evaluation.list`, `foundry.evaluation.get`, and
  `foundry.evaluation.start`, with counts as attributes.
- A `demo.journey` value such as `evaluate` for the start route, so the
  answer-generation spans group under it.
- An allow-listed event `evaluation_run_started` with the suite name, item
  count, and status. No question text, answers, IDs on metrics, or keys.

## Testing

Required tests (`eps-demo-testing-solid`), with a fake transport, never live:

- The suite config builds the expected `POST evals` body; every `{{item.x}}` a
  grader reads is a field the app sends; the judge model is substituted.
- The dataset loader rejects bad rows and duplicate IDs.
- Every dataset row passes the exact checks against the real logic in fake mode.
- Scoring: passed, failed, and not fully scored; `sample.error` inside a
  completed result is an error; informational graders never fail a question.
- Error categories, and no raw error text or principal IDs in responses.
- Judge token use is counted once (Foundry repeats built-in usage under
  `azure_ai_evaluation`).
- Start: creates the suite once, sends the answers, and enforces one at a time,
  hourly, and daily limits; an old stuck run does not block.
- Presenter key: hash check, wrong-key limits, and "turned off" when unset.
- The HTTP transport sends a bearer token for `https://ai.azure.com/.default`,
  maps 404, and hides error bodies.
- API routes: status codes and `Cache-Control: no-store`.
- Frontend: ID and portal-link validation, the recorded example, opening a run,
  filtering to failed rows, starting with a key, polling, and error states.

## Docs

Add `docs/evaluations/README.md` (`eps-demo-docs`), starting with "In plain
language". Cover: how to use the page; what is tested and why; the dataset and
families; every grader and whether it is required; the pass rule; how one run
works, with the REST calls; identities and roles (with the custom role's data
actions); network; settings; the presenter key and how to rotate it; how to
change the suite; measured cost per run with the token counts; troubleshooting;
and how to present it. Also add an ADR for the data-source and role choices, a
cost line, threat-model rows (cost abuse, error disclosure, privilege), the
telemetry event, a code-tour step, and a compliance row.

## Presenting

If the repo has the opt-in presentation experience (`eps-demo-presentation`),
add the Evaluations page to the Demo Window allow-list and to the slide about
testing. Do not start a new run during a talk: it takes minutes. Show the newest
finished run, open **Failed**, and read the judge's reason out loud. Then open
Foundry's own totals and explain why they differ.

## Cost

Measure one real run and write the numbers down: answer-model calls and tokens,
judge calls and tokens, and the total at list prices from `config/models.json`.
Example (bank demo, 18 questions, two judge graders): about $0.04 per run, of
which $0.016 for 17 answers on GPT-4.1 and $0.022 for 36 judge calls on
GPT-4.1 mini. Nothing is charged between runs. Do not turn on continuous
evaluation for a demo unless an ADR says why.

## Release verification

Prove each item on the deployed demo, not locally:

1. Start a run from the page with the presenter key. It finishes, and the page
   shows every question and grade.
2. Open the same run in the Foundry portal from the page's link.
3. A wrong key returns 403; a second start during a run returns 409.
4. The judge grader produced grades (no `access_denied` errors), which proves
   the project identity's judge-model role.
5. List the role assignments on the Foundry account and project. For
   evaluations, the app has Foundry User on the project and the custom runner
   role on the account, and nothing broader.
6. The page in fake or local mode shows the recorded example, marked not live.
7. The Foundry account's network setting matches the ADR (public endpoint with
   Entra ID only, or network injection), and API keys are disabled.

## Anti-patterns to refuse

- Sending a Foundry token, key, or raw Foundry error to the browser.
- Scoring a question from `result_counts` or the run status alone.
- Letting a built-in judge that punishes refusals decide pass or fail in a
  safety demo.
- Giving the app Foundry Owner, Contributor, Foundry User on the whole account,
  or Cognitive Services OpenAI Contributor "to make evals work".
- Starting runs without a key, or limits kept only in memory.
- Adding roles to fix `UnauthorizedUserAction: Forbidden` before checking the
  Foundry account's network setting.
- Real customer data in the dataset or in item fields.
- Editing a suite's graders in place instead of creating a new suite name.

## References

- [Evaluation in Microsoft Foundry](https://learn.microsoft.com/azure/foundry/concepts/observability)
- [Azure OpenAI graders](https://learn.microsoft.com/azure/foundry/concepts/evaluation-evaluators/azure-openai-graders)
- [Configure virtual network support for evaluation](https://learn.microsoft.com/azure/foundry/concepts/evaluation-virtual-network)
- [Troubleshoot evaluation and observability issues](https://learn.microsoft.com/azure/foundry/observability/how-to/troubleshooting)
