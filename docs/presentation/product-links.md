# Products and links

This page lists every product named in the talk, what each one does in plain
language, and where to learn more. Links were checked on 2026-10-02.

## How the pieces fit

| Product                                    | Its job, in one sentence                                                                        | Used in this demo?                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Microsoft Foundry**                      | Hosts the AI models and grades answers with evaluators.                                         | Yes: GPT-4.1 models, tracing, and the Evaluations page             |
| **Azure AI Evaluation SDK**                | Runs Foundry-style quality and safety evaluators from your own code or CI.                      | Not directly. The app calls the Foundry evaluation service instead |
| **Azure AI Content Safety**                | Checks text and images for harmful content. It covers safety only, not quality.                 | Yes, through the model's content filters                           |
| **Agent Governance Toolkit (AGT)**         | The umbrella toolkit for governing agents: policy, identity, audit, and red-team tools.         | Yes: it supplies the ACS SDK                                       |
| **ACS (Agent Control Specification)**      | AGT's policy engine. It _defines and enforces_ rules at set points while the agent runs.        | Yes: input, pre-tool-call, and post-tool-call checks               |
| **ASSERT**                                 | _Verifies_ behavior. It turns written rules into test conversations and has a judge score them. | Yes: an offline red-team comparison of the two lanes               |
| **Azure Monitor and Application Insights** | Collects traces, logs, and metrics so you can prove what happened.                              | Yes: dashboards, workbooks, and trace links                        |

A simple way to remember it: **ACS enforces, ASSERT verifies, Microsoft Foundry
evaluates, and Azure Monitor records.** ACS is part of AGT. ASSERT is a separate
open-source project from the same family. Its guided workflow can finish by
generating an ACS policy and re-running the tests to prove the fix.

## Microsoft Foundry

- Product page: <https://azure.microsoft.com/products/ai-foundry>
- Portal: <https://ai.azure.com>
- What is Microsoft Foundry: <https://learn.microsoft.com/azure/foundry/what-is-foundry>
- Observability overview (evaluation, monitoring, tracing): <https://learn.microsoft.com/azure/foundry/concepts/observability>
- Built-in evaluators reference: <https://learn.microsoft.com/azure/foundry/concepts/built-in-evaluators>
- Agent evaluators: <https://learn.microsoft.com/azure/foundry/concepts/evaluation-evaluators/agent-evaluators>
- Risk and safety evaluators: <https://learn.microsoft.com/azure/foundry/concepts/evaluation-evaluators/risk-safety-evaluators>
- Azure OpenAI graders (String Checker, Model Labeler, and more): <https://learn.microsoft.com/azure/foundry/concepts/evaluation-evaluators/azure-openai-graders>
- Custom evaluators: <https://learn.microsoft.com/azure/foundry/concepts/evaluation-evaluators/custom-evaluators>
- Cloud evaluation with the Foundry SDK: <https://learn.microsoft.com/azure/foundry/observability/how-to/cloud-evaluation>
- Evaluation permissions (roles): <https://learn.microsoft.com/azure/foundry/observability/how-to/evaluation-permissions>
- AI Red Teaming Agent: <https://learn.microsoft.com/azure/foundry/concepts/ai-red-teaming-agent>
- Agent tracing: <https://learn.microsoft.com/azure/foundry/observability/concepts/trace-agent-concept>
- Agent Monitoring Dashboard: <https://learn.microsoft.com/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard>
- Observability pricing: <https://azure.microsoft.com/pricing/details/foundryobservability/>

### Evaluator families

| Family                    | What it checks                                                     | Examples                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality (general purpose) | Is the answer clear and easy to follow?                            | Coherence, Fluency                                                                                                                                                                                         |
| RAG (search, then answer) | Is the answer based on the right sources?                          | Groundedness, Groundedness Pro, Relevance, Retrieval, Document Retrieval, Response Completeness                                                                                                            |
| Risk and safety           | Is anything harmful, leaked, or forbidden?                         | Hate and Unfairness, Sexual, Violence, Self-Harm, Protected Materials, Indirect Attack, Code Vulnerability, Ungrounded Attributes, Prohibited Actions, Sensitive Data Leakage                              |
| Agent                     | Did the agent understand, pick the right tool, and finish the job? | Intent Resolution, Task Adherence, Task Completion, Tool Call Accuracy, Tool Selection, Tool Input Accuracy, Tool Output Utilization, Tool Call Success, Task Navigation Efficiency, Customer Satisfaction |
| Text similarity (NLP)     | How close is the answer to a known good answer?                    | Similarity, F1 Score, BLEU, GLEU, ROUGE, METEOR                                                                                                                                                            |
| Rubric                    | Scores against your own weighted criteria with a judge model.      | Rubric                                                                                                                                                                                                     |
| Azure OpenAI graders      | Your own exact checks or judge prompts.                            | String Checker, Model Labeler, Model Scorer, Text Similarity                                                                                                                                               |
| Custom                    | Your own scoring code or prompt.                                   | Custom evaluators                                                                                                                                                                                          |

Some evaluators are in preview. The reference page marks which ones. This demo
uses **String Checker** for exact rules, **Model Labeler** as the judge, and
**Intent Resolution** for information only. See
[the evaluations guide](../evaluations/README.md).

## Azure AI Evaluation SDK and Azure AI Content Safety

- Azure AI Evaluation SDK (Python): <https://learn.microsoft.com/python/api/overview/azure/ai-evaluation-readme>
- Package: <https://pypi.org/project/azure-ai-evaluation/>
- Azure AI Content Safety: <https://learn.microsoft.com/azure/ai-services/content-safety/overview>

The SDK covers quality _and_ safety. Content Safety covers safety only.

## Agent Governance Toolkit (AGT)

- Repository (MIT license, Public Preview): <https://github.com/microsoft/agent-governance-toolkit>
- Documentation: <https://microsoft.github.io/agent-governance-toolkit>
- Python package: <https://pypi.org/project/agent-governance-toolkit/>

## ACS (Agent Control Specification)

- ACS in AGT: <https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/packages/agent-control-specification.md>
- Policy engine source: <https://github.com/microsoft/agent-governance-toolkit/tree/main/policy-engine>
- Specification: <https://github.com/microsoft/agent-governance-toolkit/blob/main/policy-engine/spec/SPECIFICATION.md>
- Original repository: <https://github.com/responsibleai/agent-control-spec>
- Open Policy Agent (runs the Rego rules in this demo): <https://www.openpolicyagent.org/>

ACS can check eight points in an agent's loop. This demo uses three: `input`,
`pre_tool_call`, and `post_tool_call`. Each check returns allow, warn, deny,
escalate, or transform.

## ASSERT

- Repository (MIT license): <https://github.com/responsibleai/ASSERT>
- Project website: <https://responsibleai.github.io/ASSERT/>
- Package: <https://pypi.org/project/assert-ai/>
- How this demo runs it: [evals/README.md](../../evals/README.md)

## Evidence and hosting

- Application Insights and OpenTelemetry: <https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview>
- OpenTelemetry GenAI conventions: <https://opentelemetry.io/docs/specs/semconv/gen-ai/>
- Azure Container Apps: <https://learn.microsoft.com/azure/container-apps/overview>
- PyRIT, the red-teaming tool behind the AI Red Teaming Agent: <https://github.com/Azure/PyRIT>
