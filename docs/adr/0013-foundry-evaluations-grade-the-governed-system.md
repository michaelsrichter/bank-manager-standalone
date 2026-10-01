# ADR 0013: Foundry Evaluations grade the governed system

- Status: accepted
- Date: 2026-10-01
- Context: The demo needed an evaluation page like the ELK Burgers demo: test
  questions graded by Microsoft Foundry, saved in the Foundry project, readable
  in the web app and the Foundry portal, and startable by a presenter. ELK
  Burgers points Foundry at a **hosted agent** (`azure_ai_target_completions`),
  so Foundry calls the agent itself. This demo has no hosted agent. Its most
  important behavior is the ACS policy, which runs inside the app, so Foundry
  could not reach it by calling a model or an agent.
- Decision:
  - The app runs each test question through the real pipeline (AI model, then
    ACS policy) and sends the recorded answers to Foundry as a `jsonl` run with
    inline `file_content`. Foundry grades them and stores the run.
  - Exact checks (`string_check`) grade the tool choice, the policy decision,
    and masking. A `label_model` judge (`gpt-4.1-mini`) grades safety and fit.
    Foundry's built-in `intent_resolution` grader is kept for discussion but does
    not decide pass or fail, because it scores correct refusals as failures.
  - The app scores each question from every required grader result, not from
    Foundry's overall counts.
  - The app's managed identity gets **Foundry User on the project** (Microsoft's
    documented evaluation role, kept off the account) plus a custom **Foundry
    evaluation runner** role on the account with six data actions, because
    Foundry creates matching OpenAI evals on the account as the caller. We
    avoided Foundry User on the account (can list keys) and Cognitive Services
    OpenAI Contributor (files and fine-tuning). The custom role alone could read
    runs but could not start them. The Foundry project's managed identity gets
    the roles it needs to run graders and call the judge model.
  - Starting a run needs a presenter key. Only its SHA-256 hash is configured.
- Consequences:
  - Good: one run grades the model and the rules together, which is what the
    talk claims ("the model proposes, policy decides").
  - Good: no keys, least-privilege roles, and every run is saved in Foundry.
  - Bad: the answers are produced by the app, so Foundry's run record shows a
    dataset, not a model or agent target. The run metadata records the app
    version and answer model instead.
  - Bad: the presenter key is a shared secret held by people. It is rotated with
    `tools/set-presenter-key.ps1`.
