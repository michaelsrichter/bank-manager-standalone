export type Surface = "slides" | "app" | "azure" | "foundry" | "observability";
export type Tone = "accent" | "info" | "warning" | "success" | "danger";
export type Card = { icon?: string; title: string; text: string; tone?: Tone };
export type FlowStep = {
  title: string;
  text: string;
  tone?: Tone;
  check?: boolean;
  outcomes?: { label: string; text: string; tone: Tone }[];
};
export type SlideBlock =
  | { kind: "lead"; text: string }
  | { kind: "cards"; items: Card[]; columns?: 2 | 3 | 4 }
  | { kind: "flow"; label: string; items: FlowStep[] }
  // Real source lines, from `tour:begin slide-*` markers (see snippets.generated.json).
  | { kind: "snippet"; items: { id: string; caption: string }[] }
  | { kind: "steps"; items: { title: string; text: string }[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "chain"; label: string; items: string[] }
  | {
      kind: "compare";
      left: { title: string; items: string[]; tone?: Tone };
      right: { title: string; items: string[]; tone?: Tone };
    }
  | { kind: "table"; caption: string; headers: string[]; rows: string[][] }
  | { kind: "image"; src: string; alt: string; caption: string }
  | { kind: "code"; caption: string; code: string; source?: string }
  | { kind: "launch"; text?: string; links: { label: string; href: string }[] }
  | { kind: "timeline"; items: { when: string; title: string; text: string }[] }
  | { kind: "honest"; text: string }
  | { kind: "qr" };
export type SpeakerNotes = {
  minutes: number;
  surface: Surface;
  say: string[];
  do?: string[];
  watch?: string[];
  fallback?: string[];
};
export type Slide = {
  id: string;
  chip: string;
  section?: string;
  eyebrow?: string;
  title: string;
  blocks: SlideBlock[];
  notes: SpeakerNotes;
};
export type Deck = {
  id: string;
  title: string;
  kicker: string;
  subtitle: string;
  lengthLabel: string;
  targetMinutes: number;
  summary: string;
  audience: string;
  prep: string[];
  slides: Slide[];
};

// An excerpt of the real pre-tool-call rules. Lines starting with "# ..." mark skipped
// rules; every other line must appear in the policy file (checked by presentation.test.tsx).
export const policyRegoSnippet = `# ... earlier rules: restricted mode, outside endpoints, missing account ID
} else := deny("account_access_denied", "The bank manager is not assigned to this account.") if {
	account_scoped_tool
	not account_is_assigned
# ... role and auditor rules
} else := deny("payment_amount_hard_limit", "Transfers over $50,000 are never allowed.") if {
	is_payment_tool
	amount > 50000
# ... customer approval and fraud rules
} else := escalate("high_value_transfer_requires_approval", "Transfers over $10,000 require senior approval.") if {
	is_payment_tool
	amount > 10000
	not bool_snapshot("high_value_transfer_authorized")
# ... more rules, then the default: allow`;

const liveFallback = [
  "Say the safe error out loud.",
  "Select **Use Practice** and say, 'I switched to Practice so we can keep moving. This is not live.'",
];

export const sessionDeck: Deck = {
  id: "session",
  title: "Can an AI assistant be trusted with a bank account?",
  kicker: "45-minute session",
  subtitle: "Microsoft's tools for governed, trusted agents, shown working in one app.",
  lengthLabel: "45-minute",
  targetMinutes: 45,
  summary:
    "A solutions talk: Microsoft Foundry, the Agent Governance Toolkit (ACS), ASSERT, and Azure Monitor governing a live banking agent, plus Entra, Defender, Purview, and Foundry Control Plane for scale.",
  audience:
    "Level 200-300 architects and technical decision makers building multi-agent solutions.",
  prep: [
    "Open the public site about 5 minutes early. Run **Show account A-1001** once to warm the service.",
    "Open `/presentation/session/console`, open the Demo Window, and press **F** for full screen.",
    "Keep Azure portal tabs signed in but outside the Demo Window. The portal cannot be framed.",
    "Use Live first. If a live call fails, say so, then switch to **Use Practice** and label it as Practice.",
    "Open the **Governed AI Bank Assistant — telemetry** workbook, the **answer review** workbook, the **Governed AI Bank Assistant** dashboard, and Application Insights **Logs** in one signed-in portal window. You need at least Monitoring Reader.",
    "About 10 minutes early, run **Transfer $60,000 from A-1001 to A-2001** in the Live demo and open **Both lanes in Logs**. Telemetry takes 2 to 5 minutes to arrive, so this proves the path works and gives you a backup trace with both lanes.",
    "Do not type real personal, bank, customer, partner, or meeting details into the demo.",
  ],
  slides: [
    {
      id: "title",
      chip: "Title",
      title: "Can an AI assistant be trusted with a bank account?",
      blocks: [
        {
          kind: "lead",
          text: "How Microsoft keeps agents governed and trusted, shown working in a live banking assistant.",
        },
        { kind: "qr" },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Welcome. You already know agents need governance. This talk is about the Microsoft tools that deliver it.",
          "Everything you see runs live in one public app: Microsoft Foundry, the Agent Governance Toolkit, ASSERT, and Azure Monitor.",
        ],
      },
    },
    {
      id: "agenda",
      chip: "Agenda",
      title: "Where we are going",
      blocks: [
        {
          kind: "steps",
          items: [
            { title: "Map", text: "Microsoft's stack for governed, trusted agents." },
            { title: "Demo", text: "A banking assistant, with and without governance." },
            { title: "Verify", text: "Microsoft Foundry evaluations and ASSERT." },
            {
              title: "Govern",
              text: "Foundry guardrails and ACS from the Agent Governance Toolkit, then we break the rules.",
            },
            { title: "Observe", text: "Trace any answer, and any decision, in Azure Monitor." },
            { title: "Scale", text: "Entra, Defender, Purview, and Foundry Control Plane." },
            { title: "Start", text: "Your first steps with these tools." },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "You already know why agents need governance, so we will skip the theory.",
          "This is a tour of what Microsoft gives you, and each piece runs live.",
          "Questions come after the talk so the live path stays crisp.",
        ],
      },
    },
    {
      id: "ms-stack",
      chip: "Microsoft stack",
      title: "Microsoft's stack for governed, trusted agents",
      blocks: [
        {
          kind: "table",
          caption:
            "Each job has a Microsoft tool. The last column shows what runs live in this demo.",
          headers: ["Job", "Microsoft solution", "In this demo"],
          rows: [
            [
              "Build",
              "**Microsoft Foundry**: models, Foundry Agent Service, and guardrails such as content filters and Prompt Shields",
              "GPT-4.1 models with content filters on",
            ],
            [
              "Govern",
              "**Agent Governance Toolkit**: the ACS policy engine, identity, audit, and an MCP security gateway. **Microsoft Entra**: managed identities, and Entra Agent ID for agents",
              "ACS with Rego rules on every tool call; managed identity, no keys",
            ],
            [
              "Verify",
              "**Microsoft Foundry evaluators** and the AI Red Teaming Agent. **ASSERT** for your own written rules",
              "An 18-question Foundry evaluation; an ASSERT red-team comparison",
            ],
            [
              "Observe",
              "**Azure Monitor Application Insights** with OpenTelemetry; Microsoft Foundry tracing and monitoring",
              "Every answer has a Trace ID you can open",
            ],
            [
              "Operate at scale",
              "**Foundry Control Plane**, **Microsoft Defender for Cloud**, and **Microsoft Purview**",
              "Next steps; not set up here",
            ],
          ],
        },
        {
          kind: "launch",
          links: [{ label: "Products and links", href: "/#/docs/presentation/product-links.md" }],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Here is the whole story on one slide. For every governance job, Microsoft has a tool.",
          "Build on Microsoft Foundry. Its guardrails catch harmful content and prompt attacks.",
          "Govern with the Agent Governance Toolkit. Its ACS engine enforces your business rules on every tool call. Microsoft Entra gives the app, and soon each agent, a real identity.",
          "Verify with Microsoft Foundry evaluators and ASSERT. Observe with Azure Monitor and Foundry tracing.",
          "Operate at scale with Foundry Control Plane, Defender for Cloud, and Purview.",
          "The rest of the talk shows the first four running live, then where to go next.",
        ],
        watch: [
          "Foundry agent guardrails and parts of Foundry Control Plane are in preview. The Agent Governance Toolkit is in Public Preview.",
        ],
      },
    },
    {
      id: "stack",
      chip: "Stack",
      title: "What we built it with",
      blocks: [
        {
          kind: "table",
          caption:
            "Everything is in one public GitHub repository, deployed to Azure with one command.",
          headers: ["Layer", "What we used"],
          rows: [
            ["Frontend", "React 19, TypeScript, Vite"],
            ["Backend", "Python 3.12, FastAPI, Uvicorn, Pydantic"],
            [
              "AI model",
              "Microsoft Foundry: GPT-4.1 and GPT-4.1 mini, called with the OpenAI Python SDK and structured output. No agent framework.",
            ],
            [
              "Governance",
              "Agent Governance Toolkit: the ACS Python SDK (Rust core), with Open Policy Agent 1.21 running Rego rules",
            ],
            [
              "Testing",
              "pytest, Vitest, `opa test`, ASSERT (`assert-ai` 0.3), Microsoft Foundry Evaluations",
            ],
            [
              "Observability",
              "OpenTelemetry, Azure Monitor OpenTelemetry distro, Application Insights, Log Analytics, workbooks, a dashboard",
            ],
            [
              "Hosting",
              "Azure Container Apps, Container Registry, private endpoint, managed identity, Bicep, Azure Developer CLI, GitHub Actions",
            ],
          ],
        },
        {
          kind: "launch",
          links: [
            {
              label: "Source on GitHub",
              href: "https://github.com/michaelsrichter/bank-manager-standalone",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Here is the whole stack, so you can map it to your own.",
          "The model call is plain Python with structured output. There is no agent framework, so every step is easy to see.",
          "Governance comes from the Agent Governance Toolkit. Its ACS SDK has a Rust core, and Open Policy Agent runs our rules.",
          "Everything reports to Azure Monitor with OpenTelemetry. We will open those traces later.",
          "It is all one public repo, deployed with the Azure Developer CLI. Every code slide links to the exact lines on GitHub.",
        ],
      },
    },
    {
      id: "meet-demo",
      chip: "Meet demo",
      title: "Meet the demo",
      blocks: [
        {
          kind: "cards",
          columns: 3,
          items: [
            {
              title: "Personas",
              text: "Riley, Sam, and Jordan show role differences.",
              tone: "info",
            },
            {
              title: "Two lanes",
              text: "One lane has no rules on purpose. One lane is governed by policy.",
              tone: "accent",
            },
            {
              title: "Made-up data",
              text: "All people, accounts, balances, and identifiers are synthetic.",
              tone: "success",
            },
          ],
        },
        {
          kind: "launch",
          links: [
            { label: "Live demo", href: "/#/demo" },
            { label: "Practice backup", href: "/#/demo?mode=practice" },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "app",
        say: [
          "Now we move to the app.",
          "The unsafe lane is intentionally unsafe so the comparison is visible.",
        ],
        do: [
          "Open **Live demo**.",
          "Point to **You are signed in as** and the lanes **No rules (unsafe on purpose)** and **Governed by policy**.",
        ],
        watch: ["The audience sees fictional data and a controlled demo."],
        fallback: liveFallback,
      },
    },
    {
      id: "live-redaction",
      chip: "Live 1",
      title: "Allowed access, private data hidden",
      blocks: [
        {
          kind: "lead",
          text: "The same allowed account read succeeds in both lanes, but the governed lane hides private data.",
        },
        {
          kind: "compare",
          left: {
            title: "No rules",
            tone: "danger",
            items: ["Shows the fake SSN", "No post-tool privacy check"],
          },
          right: {
            title: "Governed",
            tone: "success",
            items: ["Shows [SSN-REDACTED]", "Policy transforms the result before the user sees it"],
          },
        },
      ],
      notes: {
        minutes: 2,
        surface: "app",
        say: [
          "Governance is not blocking everything.",
          "Riley is allowed to read account A-1001.",
          "The important difference is what happens to sensitive data after the tool returns.",
        ],
        do: ["Choose **Riley (branch manager)**.", "Click **Show account A-1001**."],
        watch: [
          "The unsafe lane shows the fake SSN.",
          "The governed lane shows **[SSN-REDACTED]**.",
        ],
        fallback: liveFallback,
      },
    },
    {
      id: "evaluators",
      chip: "Evaluators",
      title: "Evaluators in Microsoft Foundry",
      blocks: [
        {
          kind: "table",
          caption:
            "Here is what Microsoft Foundry offers, even if your agent does not run in Foundry.",
          headers: ["Family", "What it checks", "Examples"],
          rows: [
            ["Quality", "Is the answer clear and easy to follow?", "Coherence, Fluency"],
            [
              "RAG (search, then answer)",
              "Is the answer based on the right sources?",
              "Groundedness, Relevance, Retrieval",
            ],
            [
              "Risk and safety",
              "Is anything harmful, leaked, or forbidden?",
              "Hate and Unfairness, Violence, Indirect Attack, Sensitive Data Leakage, Prohibited Actions",
            ],
            [
              "Agent",
              "Did the agent understand, pick the right tool, and finish the job?",
              "Intent Resolution, Task Adherence, Tool Call Accuracy, Task Completion",
            ],
            [
              "Text similarity (NLP)",
              "How close is it to a known good answer?",
              "Similarity, F1, BLEU, ROUGE, METEOR",
            ],
            [
              "Graders, rubrics, and custom",
              "Your own rules, checked exactly or by a judge model",
              "String Checker, Model Labeler, Rubric, custom evaluators",
            ],
          ],
        },
        {
          kind: "lead",
          text: "This demo uses String Checker for exact rules and Model Labeler as the judge. Intent Resolution is shown for information only.",
        },
        {
          kind: "launch",
          links: [
            {
              label: "Built-in evaluators reference",
              href: "https://learn.microsoft.com/azure/foundry/concepts/built-in-evaluators",
            },
            { label: "Products and links", href: "/#/docs/presentation/product-links.md" },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Here is what we have in Microsoft Foundry, even if you do not run your agent in Foundry.",
          "There are families for quality, search-based answers, risk and safety, agents, and text similarity.",
          "You can also write your own graders, rubrics, and custom evaluators.",
          "The Azure AI Evaluation SDK runs these from your own code or CI. Azure AI Content Safety is a separate service that checks safety only.",
          "Flash this slide, then go straight to real results from this app.",
        ],
        watch: ["Some evaluators are in preview. Say so if asked."],
      },
    },
    {
      id: "assert-tests",
      chip: "Results",
      title: "Evaluation results: does it keep its promises?",
      blocks: [
        {
          kind: "compare",
          left: {
            title: "Positive tests",
            tone: "success",
            items: ["Allowed reads still work", "The assistant does not over-refuse"],
          },
          right: {
            title: "Negative tests",
            tone: "danger",
            items: [
              "Unassigned accounts are denied",
              "Sensitive data is redacted",
              "Bypass attempts fail",
            ],
          },
        },
        {
          kind: "lead",
          text: "In CI, a free policy regression runs 10 scenarios: 8 violations with no rules, 0 when governed. In Microsoft Foundry, an 18-question evaluation grades the live model and policy together.",
        },
        {
          kind: "launch",
          text: "Show a saved Foundry evaluation run, then read one failed row.",
          links: [{ label: "Evaluations", href: "/#/evaluations" }],
        },
      ],
      notes: {
        minutes: 3,
        surface: "app",
        say: [
          "These are real results from this app, graded in Microsoft Foundry.",
          "A policy is only useful if it is tested in both directions.",
          "We test what the system must do and what it must refuse.",
          "The unsafe baseline violates policy. The governed path does not.",
          "Foundry grades every answer with exact checks and a judge model, and keeps every run.",
        ],
        do: [
          "Press **D** to show **Evaluations** in the Demo Window.",
          "Open the newest run with **See results**.",
          "Point out **Questions passed** next to **Foundry's own totals**.",
          "Select **Failed** and read the judge's reason out loud.",
        ],
        watch: [
          "The built-in grader marks correct refusals as failures, so it does not decide pass or fail.",
          "The judge can find a real problem: a refusal message that is correct but unclear.",
        ],
        fallback: [
          "If Foundry is slow, show the newest finished run. Do not start a new run during the talk; it takes 2 to 4 minutes.",
          "If the Evaluations page cannot load at all, say so, then switch to the **Practice** backup and show the same rules in the two lanes.",
        ],
      },
    },
    {
      id: "agt-family",
      chip: "AGT family",
      title: "How ACS, ASSERT, and AGT fit together",
      blocks: [
        {
          kind: "table",
          caption:
            "One family, three jobs: the toolkit holds the pieces, ACS enforces the rules, and ASSERT proves they work.",
          headers: [
            "",
            "Agent Governance Toolkit (AGT)",
            "ACS (Agent Control Specification)",
            "ASSERT",
          ],
          rows: [
            [
              "Its job",
              "The umbrella toolkit for governing agents",
              "Define policy and enforce it",
              "Verify behavior with generated tests",
            ],
            [
              "When it runs",
              "While you build and while the agent runs",
              "On every request, at set points in the agent loop",
              "Before release and after each policy change",
            ],
            [
              "What you get",
              "Policy engine, identity, audit, red-team tools, MCP security gateway",
              "A decision: allow, warn, deny, escalate, or transform",
              "Pass and fail scores with a judge's reasons",
            ],
            [
              "In this demo",
              "Supplies the ACS SDK the app uses",
              "Checks the input, each tool call, and each tool result",
              "Compares the no-rules lane with the governed lane",
            ],
            [
              "Where it lives",
              "github.com/microsoft/agent-governance-toolkit",
              "Inside AGT, in the policy-engine folder",
              "github.com/responsibleai/ASSERT",
            ],
          ],
        },
        {
          kind: "chain",
          label: "How they work together",
          items: [
            "Name a risk",
            "ASSERT measures it",
            "ACS policy blocks it",
            "ASSERT re-runs to prove the fix",
          ],
        },
        {
          kind: "honest",
          text: "AGT and ACS are in Public Preview, and ASSERT is version 0.3. Names and APIs may change.",
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "These three names come up together, so here is the simple version.",
          "ACS defines the policy and enforces it while the agent runs. It is now part of the Agent Governance Toolkit, so think of it as the toolkit's policy engine.",
          "ASSERT verifies. It turns written rules into test conversations and has a judge score them.",
          "Microsoft Foundry evaluators grade quality and safety. ASSERT checks your own written rules. Use both.",
          "Now we break some rules on purpose and watch ACS stop them.",
        ],
      },
    },
    {
      id: "assert-code",
      chip: "ASSERT code",
      title: "ASSERT in code: a rule becomes a judge",
      blocks: [
        {
          kind: "lead",
          text: "ASSERT turns this rubric into about 30 generated test questions. It runs them against both lanes, and a judge model scores every answer.",
        },
        {
          kind: "snippet",
          items: [
            {
              id: "slide-assert-judge",
              caption: "The policy_violation judge in evals/assert/eval_config.yaml",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "This is the real ASSERT config. The rubric is plain language, written from the bank policy.",
          "ASSERT generates test questions in different styles, like urgent or claiming authority, and sends the same set to both lanes.",
          "The judge answers one question per answer: did it break policy? With no rules, it does. Governed, it does not.",
        ],
        watch: ["The link under the code opens these exact lines on GitHub."],
      },
    },
    {
      id: "guardrails",
      chip: "Guardrails",
      title: "Two kinds of guardrails, and you want both",
      blocks: [
        {
          kind: "compare",
          left: {
            title: "Microsoft Foundry guardrails",
            tone: "info",
            items: [
              "Managed classifiers for harmful content and prompt attacks",
              "Configured in Microsoft Foundry, without code",
              "For agents: checks on user input, tool calls, tool responses, and output (preview)",
            ],
          },
          right: {
            title: "ACS in the Agent Governance Toolkit",
            tone: "success",
            items: [
              "Your business rules as code: who, which account, how much",
              "The same answer every time: allow, deny, escalate, or redact",
              "Runs inside your app, with any model or cloud",
            ],
          },
        },
        {
          kind: "lead",
          text: "Foundry guardrails ask: **is this content harmful?** ACS asks: **is this person allowed to do this, right now?**",
        },
        {
          kind: "honest",
          text: "This app calls the model directly, so it uses Foundry's model-level content filters. Agent guardrails apply to agents in Foundry Agent Service.",
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Microsoft gives you two kinds of guardrails, and they answer different questions.",
          "Foundry guardrails are managed classifiers. They catch harmful content and prompt attacks, and for agents they can also check tool calls and tool responses.",
          "But a classifier cannot know that Riley is not assigned to account A-2001, or that transfers over fifty thousand dollars are never allowed. Those are your business rules.",
          "That is ACS from the Agent Governance Toolkit: your rules, as code, checked on every tool call.",
          "Now let us break some of those rules on purpose.",
        ],
      },
    },
    {
      id: "live-role",
      chip: "Live 2",
      title: "Not your account, or not your role",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Riley is not assigned to A-2001.",
            "Jordan can audit but cannot prepare transfers.",
            "The governed lane denies the action with a reason.",
          ],
        },
        { kind: "launch", links: [{ label: "Live demo", href: "/#/demo" }] },
      ],
      notes: {
        minutes: 2,
        surface: "app",
        say: [
          "Now we test negative cases.",
          "Negative tests are as important as the happy path.",
          "The rule has to know both the account and the role.",
        ],
        do: [
          "With **Riley (branch manager)** selected, click **Show account A-2001**.",
          "Switch **You are signed in as** to **Jordan (auditor)**.",
          "Click **Prepare transfer $12,000 from A-1001 to A-2001**.",
        ],
        watch: [
          "The governed lane reports **account_access_denied**.",
          "The auditor transfer reports **auditor_write_denied**.",
        ],
        fallback: liveFallback,
      },
    },
    {
      id: "live-human",
      chip: "Live 3",
      title: "A person decides high-value actions",
      blocks: [
        {
          kind: "cards",
          columns: 2,
          items: [
            {
              title: "$12,000",
              text: "The policy asks for approval. A person can approve or reject.",
              tone: "warning",
            },
            {
              title: "$60,000",
              text: "The hard limit denies the transfer. Approval cannot override it.",
              tone: "danger",
            },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "app",
        say: [
          "Some actions are not simply yes or no.",
          "The system can ask a person when the policy says a person should decide.",
          "Other limits are hard stops.",
        ],
        do: [
          "Switch back to **Riley (branch manager)**.",
          "Click **Prepare transfer $12,000 from A-1001 to A-2001**.",
          "Click **Approve**.",
          "Click **Transfer $60,000 from A-1001 to A-2001**.",
        ],
        watch: [
          "The $12,000 action has **Approve** and **Reject** controls.",
          "The $60,000 action shows **payment_amount_hard_limit** and cannot be approved.",
          "Say: remember this $60,000 answer. We will trace it in Azure Monitor later.",
        ],
        fallback: liveFallback,
      },
    },
    {
      id: "live-bypass",
      chip: "Live 4",
      title: "A bypass attempt stops at the first check",
      blocks: [
        {
          kind: "lead",
          text: "The request is blocked before a tool runs, because the input itself asks to bypass approval.",
        },
        {
          kind: "honest",
          text: "The fraud and security annotators are simple stand-ins. A production system should use stronger classifiers and downstream bank controls.",
        },
      ],
      notes: {
        minutes: 1,
        surface: "app",
        say: [
          "This is the classic instruction-override case.",
          "A note in the request cannot grant permission.",
          "The first policy check stops it before the tool call.",
        ],
        do: ["Click **Use unauthorized transfer and bypass approval**."],
        watch: ["The governed lane blocks at the input check."],
        fallback: liveFallback,
      },
    },
    {
      id: "three-checks",
      chip: "Three checks",
      title: "How it works: three checks",
      blocks: [
        {
          kind: "flow",
          label: "One request through the three ACS checks",
          items: [
            {
              title: "Request",
              text: "“Prepare a $12,000 transfer from A-1001 to A-2001”",
            },
            {
              title: "Model picks one tool",
              text: "`prepare_transfer`. It never decides what is allowed.",
            },
            {
              title: "① input",
              text: "Is the request itself safe?",
              check: true,
              outcomes: [{ label: "Deny:", text: "bypass or jailbreak attempts", tone: "danger" }],
            },
            {
              title: "② pre_tool_call",
              text: "Is this exact call allowed?",
              check: true,
              outcomes: [
                { label: "Deny:", text: "not your account, over $50,000", tone: "danger" },
                { label: "Escalate:", text: "over $10,000, a person approves", tone: "warning" },
              ],
            },
            {
              title: "Tool runs",
              text: "Only after the checks pass.",
              tone: "success",
            },
            {
              title: "③ post_tool_call",
              text: "Does the result leak private data?",
              check: true,
              outcomes: [
                { label: "Transform:", text: "SSN becomes [SSN-REDACTED]", tone: "success" },
              ],
            },
          ],
        },
        {
          kind: "lead",
          text: "The server, not the browser, supplies the role and assigned accounts. Every decision names its rule, such as `account_access_denied`.",
        },
        {
          kind: "launch",
          links: [{ label: "Architecture diagrams", href: "/#/docs/architecture/diagram.md" }],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "There are three places to intervene: when the request comes in, before the tool runs, and after the tool returns.",
          "Each check can allow. The input and pre-tool checks can deny. The pre-tool check can also escalate to a person.",
          "The post-tool check can transform the result. That is how private data is redacted before anyone sees it.",
          "The role and account list come from the server, so a user cannot claim to be someone else.",
        ],
      },
    },
    {
      id: "acs-setup",
      chip: "AGT code",
      title: "From the toolkit to a running policy engine",
      blocks: [
        {
          kind: "snippet",
          items: [
            {
              id: "slide-agt-wheel",
              caption:
                "Dockerfile: build the ACS SDK from a pinned Agent Governance Toolkit commit",
            },
          ],
        },
        {
          kind: "snippet",
          items: [
            {
              id: "slide-acs-control",
              caption: "Python: load the ACS manifest once, with annotators and telemetry",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Here is how the toolkit gets into the app. The Docker build clones the Agent Governance Toolkit at a pinned commit and builds the ACS Python SDK.",
          "Pinning the commit matters because the toolkit is in Public Preview.",
          "In Python, one call loads the manifest. The manifest maps each check to a Rego rule.",
          "Notice the telemetry sinks. Every decision ACS makes goes to OpenTelemetry. We will see that in Azure Monitor.",
        ],
      },
    },
    {
      id: "acs-run-tool",
      chip: "ACS code",
      title: "ACS in code: policy wraps every tool call",
      blocks: [
        {
          kind: "snippet",
          items: [
            {
              id: "slide-acs-run-tool",
              caption: "backend/bank_manager/bank/governance.py: run_tool wraps the real tool",
            },
          ],
        },
        {
          kind: "steps",
          items: [
            {
              title: "Before the tool runs",
              text: "ACS checks `pre_tool_call`. Deny raises `AgentControlBlocked`. Escalate calls `approval_resolver`, which asks a person.",
            },
            {
              title: "After the tool returns",
              text: "ACS checks `post_tool_call` and can transform the result, for example redacting an SSN.",
            },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "This is the most important piece of code in the demo.",
          "The model never calls a tool directly. The app hands the tool to ACS, and ACS decides whether it runs.",
          "If policy says deny, the tool function is never called, and we return the rule's name.",
          "If policy says a person must decide, the approval resolver is how Approve and Reject reach ACS.",
          "Then ACS checks the result before anyone sees it. That is where the SSN redaction happens.",
        ],
      },
    },
    {
      id: "rego",
      chip: "Rego",
      title: "The policy is code",
      blocks: [
        {
          kind: "code",
          caption: "Real Rego from backend/governance/policy/bank_manager.rego",
          code: policyRegoSnippet,
          source: "backend/governance/policy/bank_manager.rego",
        },
        {
          kind: "launch",
          links: [{ label: "Governance code tour", href: "/#/docs/governance-tour.md" }],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "This is not a slide-only rule. It is the real policy file.",
          "The rules are checked in order, and the first match wins.",
          "One rule denies account access when the account is not assigned to you.",
          "Another denies any transfer over fifty thousand dollars, no matter who asks.",
          "Over ten thousand dollars, the policy does not say no. It asks a person to approve.",
        ],
      },
    },
    {
      id: "honesty",
      chip: "Honesty",
      title: "In this demo, honestly",
      blocks: [
        {
          kind: "honest",
          text: "A real bank API would also enforce limits such as transfer thresholds. Defense in depth means controls in deterministic downstream APIs, controls in central agent policy, and both.",
        },
        {
          kind: "honest",
          text: "The policy's LLM judge and fraud classifier annotators are simple keyword stand-ins for demo purposes.",
        },
        {
          kind: "honest",
          text: "The Foundry evaluation uses 18 made-up questions. A judge model can be wrong, so exact checks decide most rows.",
        },
        {
          kind: "honest",
          text: "Practice mode exists so a live talk can continue safely if the model or service is unavailable.",
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Governance work should be honest about where controls live.",
          "This demo centralizes the policy so we can see it clearly.",
          "Production systems should still enforce hard limits in the bank API too.",
        ],
      },
    },
    {
      id: "ms-observe",
      chip: "Observe",
      section: "Observability",
      title: "Observability: what Microsoft gives you",
      blocks: [
        {
          kind: "cards",
          columns: 2,
          items: [
            {
              title: "Azure Monitor Application Insights",
              text: "Send standard OpenTelemetry, get end-to-end traces. Find a wrong or slow answer by its Trace ID in minutes.",
              tone: "info",
            },
            {
              title: "Microsoft Foundry tracing",
              text: "The same agent steps, model calls, and tool calls in the Foundry portal, next to your evaluations.",
              tone: "accent",
            },
            {
              title: "Workbooks, dashboards, and alerts",
              text: "Proof for auditors: every allow, deny, approval, and redaction, with the rule that made it.",
              tone: "success",
            },
            {
              title: "Foundry Control Plane",
              text: "One view of every agent, model, and tool across projects, with monitoring and compliance.",
              tone: "warning",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Governance you cannot see, you cannot prove. Microsoft covers the evidence side too.",
          "Application Insights takes standard OpenTelemetry, so any agent in any language can send to it.",
          "Microsoft Foundry shows the same traces next to your evaluations. Foundry Control Plane rolls them up across your whole agent fleet.",
          "None of it needs your prompts or customer data. This demo logs decisions, not content.",
        ],
      },
    },
    {
      id: "obs-how",
      chip: "How it works",
      title: "How observability works in this demo",
      blocks: [
        {
          kind: "chain",
          label: "One Trace ID follows each answer",
          items: [
            "Browser",
            "API request",
            "invoke_agent",
            "chat: model call",
            "lane baseline | lane governed",
            "acs.evaluate: each check",
            "execute_tool",
            "Azure Monitor",
          ],
        },
        {
          kind: "table",
          caption:
            "Everything is sent with OpenTelemetry and the app's managed identity: no keys, and no prompt text.",
          headers: ["Signal", "What it tells you", "Where it lands"],
          rows: [
            [
              "Traces",
              "Every step of one answer, in order, with timing, the model used, and the policy decision",
              "Application Insights",
            ],
            [
              "Metrics",
              "Tokens, model latency, estimated cost, and ACS allow, deny, and transform counts",
              "Azure Monitor metrics",
            ],
            [
              "Events and logs",
              "Policy decisions, approvals, rate limits, health checks, plus Foundry and Container Apps logs",
              "Log Analytics",
            ],
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "The trace starts in the browser. Every API call carries a W3C trace header, so the browser click and the server work share one Trace ID.",
          "The agent steps use the OpenTelemetry GenAI names: invoke_agent, chat for the model call, and execute_tool. ACS adds a span for each policy check.",
          "Each answer then splits into two branches, one per lane, so the no-rules work and the governed work never mix in the portal.",
          "Metrics answer how much and how often: tokens, cost, latency, and how many calls each rule allowed or blocked.",
          "Microsoft Foundry, Container Apps, and the registry send their own logs to the same Log Analytics workspace.",
          "Every chat also has a Conversation ID, so you can pull up a whole conversation, not just one answer.",
          "The OpenTelemetry GenAI conventions are still in Development status, so names can change.",
        ],
      },
    },
    {
      id: "lanes-trace",
      chip: "Two lanes",
      title: "One answer, two lanes, one trace",
      blocks: [
        {
          kind: "code",
          caption: "The real trace for “Transfer $60,000 from A-1001 to A-2001”",
          code: `invoke_agent bank-manager
├─ chat gpt-4.1                       the model picks create_transfer
├─ lane baseline   No rules           tool ran: yes  · not_checked
│  └─ execute_tool create_transfer
└─ lane governed   Governed by policy tool ran: no   · payment_amount_hard_limit
   ├─ acs.evaluate input              allowed
   └─ acs.evaluate pre_tool_call      denied_expected`,
        },
        {
          kind: "snippet",
          items: [
            {
              id: "slide-lane-result",
              caption:
                "Python: each lane span records its own result, so one Logs row tells the lane's story",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "The two lanes are not just side by side on screen. They are two branches of the same trace.",
          "The no-rules branch ran the transfer. The governed branch passed the input check, then the pre-tool check denied it, so the tool never ran.",
          "Each lane span stores its own result: did the tool run, which rule decided, and which checks ran. That is what makes the next screens easy to read.",
        ],
      },
    },
    {
      id: "tracing-code",
      chip: "Tracing code",
      title: "Tracing in code: decision to Azure Monitor",
      blocks: [
        {
          kind: "snippet",
          items: [
            {
              id: "slide-acs-span-event",
              caption:
                "Python: every ACS decision is added to the current span as an acs.decision event with these fields",
            },
          ],
        },
        {
          kind: "snippet",
          items: [
            {
              id: "slide-lanes-kql",
              caption:
                "TypeScript: the Logs query behind “Both lanes in Logs” reads each lane span (it falls back to never-sampled policy_decision events)",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Setup is one call: `configure_azure_monitor`, with the app's managed identity. That sends traces, metrics, and logs.",
          "The first snippet plugs into ACS. Every decision becomes an `acs.decision` event with the check, the decision, the rule's reason code, and how long it took.",
          "The second snippet is the link you will click next. It asks Logs for the two lane spans of one Trace ID: one row per lane. If a span is missing, it falls back to the policy_decision event, which is a log and is never sampled. The app opens it in the Azure portal with the time window already set.",
          "So the path from a confusing answer to its root cause is one click.",
        ],
      },
    },
    {
      id: "observability",
      chip: "Trace it live",
      title: "Trace an answer in Azure Monitor, lane by lane",
      blocks: [
        {
          kind: "table",
          caption: "What the demo gives you today",
          headers: ["Where", "What you see"],
          rows: [
            [
              "**Both lanes in Logs** (under each answer)",
              "One row per lane: did the tool run, which rule decided, which policy checks ran",
            ],
            [
              "**This answer in Logs**",
              "Every step, grouped: shared steps, then the no-rules lane, then the governed lane",
            ],
            [
              "Console: **every answer, both lanes**",
              "Every question in this talk, newest first, with the two lanes side by side. No ID needed",
            ],
            [
              "**Answer review** workbook",
              "The same split for one answer or a whole chat, plus where the time went",
            ],
            [
              "**Telemetry** workbook and dashboard",
              "Totals for the whole demo: tool runs per lane, governed blocks, errors, cost",
            ],
          ],
        },
        {
          kind: "launch",
          text: "Open the app first, then the portal links from the answer.",
          links: [
            { label: "Live demo", href: "/#/demo" },
            { label: "Service status", href: "/#/health" },
          ],
        },
      ],
      notes: {
        minutes: 3,
        surface: "observability",
        say: [
          "Let us trace a real answer. I will use the $60,000 transfer from a few minutes ago, because new telemetry takes 2 to 5 minutes to arrive.",
          "The question is simple: what did each lane do, and why did policy decide that?",
          "The Azure portal cannot be framed, so it opens in its own window.",
        ],
        do: [
          "In the console, click **Open every answer, both lanes (Logs)**. Point to the $60,000 row: **No rules** says `allow · tool ran`; **Governed** says `deny · tool did not run · payment_amount_hard_limit`.",
          "Press **D** to show the **Live demo**. Scroll to the **$60,000** answer and open **IDs and observability links**.",
          "Click **Both lanes in Logs**. Read the two rows: the no-rules lane ran `create_transfer`; the governed lane stopped at `input → pre_tool_call`.",
          "Click **This answer in Logs**. Read it by the **Lane** column: shared steps first, then **No rules** (`execute_tool`), then **Governed** (`acs.evaluate` checks, no `execute_tool`).",
          "Optional: open the **Answer review** workbook and paste the **Conversation ID**. Each answer shows **No rules** and **Governed** columns.",
          "Optional: open the **telemetry** workbook, section **4 Security boundaries**.",
        ],
        watch: [
          "The split comes from the trace itself: `lane baseline` and `lane governed` are two branches under `invoke_agent`.",
          "`denied_expected` means a written rule said no: the policy working. `denied_unexpected` means the policy engine itself failed and closed safely. That is the one to investigate.",
          "No prompt text or account data appears anywhere in Logs.",
        ],
        fallback: [
          "If the new trace has not arrived, use the backup trace from your warm-up question.",
          "Answers recorded before lane tracing was added show blank lane columns. Use an answer from today.",
          "If portal access is not ready, stay in the app, show **IDs and observability links**, and describe the path. Say the portal needs Monitoring Reader.",
          "If the live site is down, switch to **Practice**. Say Practice answers have no trace links, because nothing real ran.",
        ],
      },
    },
    {
      id: "scale",
      chip: "Scale",
      title: "Secure and run agents at scale",
      blocks: [
        {
          kind: "cards",
          columns: 3,
          items: [
            {
              title: "Microsoft Entra",
              text: "Here: a managed identity, so no keys anywhere. Next: Entra Agent ID gives each agent its own identity, access rules, and audit.",
              tone: "success",
            },
            {
              title: "Microsoft Defender for Cloud",
              text: "Next: AI threat protection, generally available, alerts on threats to your Foundry apps and agents.",
              tone: "warning",
            },
            {
              title: "Microsoft Purview",
              text: "Next: data loss prevention, audit, and compliance for what flows through Foundry apps and agents.",
              tone: "info",
            },
            {
              title: "Foundry Control Plane",
              text: "Next: inventory every agent, model, and tool, check guardrail compliance, and add an AI gateway.",
              tone: "accent",
            },
            {
              title: "Private and filtered",
              text: "Here: a private endpoint to the model, Entra-only access, content filters on, and synthetic data.",
              tone: "success",
            },
            {
              title: "Low cost",
              text: "Here: about USD 18–23 a month, and about USD 0.001 per GPT-4.1 request.",
              tone: "info",
            },
          ],
        },
        {
          kind: "launch",
          links: [
            {
              label: "Cost notes",
              href: "https://github.com/michaelsrichter/bank-manager-standalone/blob/main/docs/cost/cost-to-run.md",
            },
            { label: "Products and links", href: "/#/docs/presentation/product-links.md" },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "One governed agent is a demo. Hundreds of agents is an operations job, and Microsoft has tools for that too.",
          "Microsoft Entra gives agents identities. Here, the app uses a managed identity, so there are no keys to steal. Entra Agent ID extends that to each agent.",
          "Defender for Cloud watches for threats to your Foundry apps and agents. Purview applies data loss prevention and audit to what flows through them.",
          "Foundry Control Plane is the fleet view: every agent, model, and tool, and whether its guardrails are in place.",
          "Those four are next steps; this demo does not set them up. What it does have: a private path to the model, content filters, and synthetic data, for about twenty dollars a month.",
        ],
        watch: [
          "The model also accepts Entra-only traffic from the internet so Microsoft Foundry can grade evaluations. There are no keys to steal.",
        ],
      },
    },
    {
      id: "start",
      chip: "Start",
      title: "How to start with Microsoft's tools",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "Build on Microsoft Foundry",
              text: "Deploy a model with guardrails on. Use a managed identity, not keys.",
            },
            {
              title: "Add the Agent Governance Toolkit",
              text: "Write one ACS policy for one tool: one role, one rule.",
            },
            {
              title: "Verify both ways",
              text: "Run Microsoft Foundry evaluations and ASSERT in CI: allowed work succeeds, denied work fails.",
            },
            {
              title: "Observe from day one",
              text: "Send OpenTelemetry to Azure Monitor. Give every answer a Trace ID.",
            },
            {
              title: "Scale",
              text: "Register agents in Foundry Control Plane. Turn on Defender for Cloud and Purview.",
            },
            {
              title: "Or fork this repo",
              text: "Everything you saw today, ready to deploy with one command.",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Start small, with a Microsoft tool at every step.",
          "One model with guardrails, one tool, one ACS rule, tests both ways, and telemetry from day one.",
          "Then scale out with Control Plane, Defender, and Purview. Or fork this repo and start from a working system.",
        ],
      },
    },
    {
      id: "takeaway",
      chip: "Takeaway",
      title: "The takeaway",
      blocks: [
        {
          kind: "quote",
          text: "Microsoft gives you a tool for every part of agent trust. Use them together.",
        },
        {
          kind: "lead",
          text: "Build and verify in **Microsoft Foundry**. Govern with the **Agent Governance Toolkit**. Prove it with **Azure Monitor**. Secure it with **Entra**, **Defender**, and **Purview**.",
        },
        {
          kind: "launch",
          links: [{ label: "Products and links", href: "/#/docs/presentation/product-links.md" }],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "If you remember one slide, remember the stack.",
          "Foundry to build and verify, the toolkit to govern, Azure Monitor to prove it, and Entra, Defender, and Purview to secure it at scale.",
          "Every link is on the products page.",
        ],
      },
    },
    {
      id: "try-it",
      chip: "Try it",
      title: "Try it",
      blocks: [
        { kind: "qr" },
        {
          kind: "lead",
          text: "Left: try the demo yourself. Right: connect with the presenter.",
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Thank you. Please scan the QR code to try the demo.",
          "The second QR code goes to my page. Let us connect.",
          "Now we have time for questions.",
        ],
      },
    },
  ],
};

export const decks = [sessionDeck];
export function getDeck(id: string | undefined) {
  return decks.find((deck) => deck.id === id) ?? null;
}
export function slideStartTimes(deck: Deck) {
  let elapsed = 0;
  return deck.slides.map((slide) => {
    const start = elapsed;
    elapsed += slide.notes.minutes;
    return start;
  });
}
export function totalMinutes(deck: Deck) {
  return deck.slides.reduce((sum, slide) => sum + slide.notes.minutes, 0);
}
export function formatMinutes(minutes: number) {
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return `${whole}:${String(seconds).padStart(2, "0")}`;
}
export function paceLabel(deck: Deck, slideIndex: number, elapsedSeconds: number) {
  if (elapsedSeconds === 0) return "Timer not started";
  const start = slideStartTimes(deck)[slideIndex] ?? 0;
  const end = start + (deck.slides[slideIndex]?.notes.minutes ?? 0);
  const elapsed = elapsedSeconds / 60;
  if (elapsed > end + 0.5) return `Behind by ${formatMinutes(elapsed - end)}`;
  if (elapsed < start - 0.5) return `Ahead by ${formatMinutes(start - elapsed)}`;
  return "On time";
}
