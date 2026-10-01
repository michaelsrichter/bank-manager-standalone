export type Surface = "slides" | "app" | "azure" | "foundry" | "observability";
export type Tone = "accent" | "info" | "warning" | "success" | "danger";
export type Card = { icon?: string; title: string; text: string; tone?: Tone };
export type SlideBlock =
  | { kind: "lead"; text: string }
  | { kind: "cards"; items: Card[]; columns?: 2 | 3 | 4 }
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
  subtitle: "A governed-agent story for partners building multi-agent solutions.",
  lengthLabel: "45-minute",
  targetMinutes: 45,
  summary:
    "A practical talk about written policy, tests, and production evidence around agents that can act.",
  audience:
    "Level 200-300 architects and technical decision makers building multi-agent solutions.",
  prep: [
    "Open the public site about 5 minutes early. Run **Show account A-1001** once to warm the service.",
    "Open `/presentation/session/console`, open the Demo Window, and press **F** for full screen.",
    "Keep Azure portal tabs signed in but outside the Demo Window. The portal cannot be framed.",
    "Use Live first. If a live call fails, say so, then switch to **Use Practice** and label it as Practice.",
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
          text: "A live demo of policy-driven governance for an assistant that can act.",
        },
        { kind: "qr" },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Welcome. Today we test whether an AI assistant can be trusted with bank-account actions.",
          "The answer is not trust the model. The answer is build controls around it.",
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
            { title: "Problem", text: "AI can choose tools and take actions." },
            { title: "Pattern", text: "The model proposes. Policy decides." },
            { title: "Demo", text: "Two lanes show unsafe and governed behavior." },
            { title: "Evidence", text: "Tests and portal traces show what happened." },
            { title: "Start", text: "How to use the pattern in your own agent." },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "We will move quickly.",
          "Questions come after the 45-minute talk so the live path stays crisp.",
        ],
      },
    },
    {
      id: "problem",
      chip: "Problem",
      title: "The problem: AI that can act",
      blocks: [
        {
          kind: "compare",
          left: {
            title: "A prompt rule",
            tone: "warning",
            items: [
              "Lives inside model instructions",
              "Can be missed or overridden",
              "Is hard to audit after the fact",
            ],
          },
          right: {
            title: "A control",
            tone: "success",
            items: ["Runs outside the model", "Has a written decision", "Can be tested and logged"],
          },
        },
        { kind: "quote", text: "A good model is not the same thing as a governable agent." },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Prompts are important, but prompt rules are still requests.",
          "When an assistant can call tools, a missed rule can become an action.",
          "A bank account makes the risk obvious.",
        ],
      },
    },
    {
      id: "model-policy",
      chip: "Idea",
      title: "The model proposes. Policy decides.",
      blocks: [
        {
          kind: "chain",
          label: "Request path",
          items: [
            "User asks",
            "Model chooses one tool",
            "Policy checks the call",
            "Tool runs, asks a person, changes output, or stops",
          ],
        },
        {
          kind: "lead",
          text: "The model chooses the likely tool. Deterministic rules make the allow, deny, approve, and redact decisions.",
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "This is the core pattern for the whole talk.",
          "The model helps understand the user's words.",
          "The model does not get the final say on money movement or private data.",
        ],
      },
    },
    {
      id: "trust-stack",
      chip: "Trust stack",
      title: "Four layers, four questions",
      blocks: [
        {
          kind: "table",
          caption: "A trust platform combines a dashboard with policy-driven governance.",
          headers: ["Layer", "Question it answers", "Role in the demo"],
          rows: [
            [
              "Foundry evaluators",
              "Is the answer good, safe, and grounded?",
              "Quality evidence; not wired into this app.",
            ],
            [
              "ASSERT",
              "Does the agent still meet its written spec?",
              "Positive and negative regression tests.",
            ],
            [
              "ACS / Agent Governance Toolkit",
              "Is this person allowed to do this operation now?",
              "Runtime policy enforcement with OPA and Rego.",
            ],
            [
              "Observability",
              "What happened in production, and can we prove it?",
              "Traces, workbooks, dashboards, and IDs.",
            ],
          ],
        },
      ],
      notes: {
        minutes: 3,
        surface: "slides",
        say: [
          "Governance is not only refusal.",
          "It means reliably doing what is allowed and reliably not doing what is not allowed.",
          "That needs quality checks, regression tests, runtime enforcement, and evidence.",
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
        minutes: 3,
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
        minutes: 3,
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
        minutes: 3,
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
        minutes: 2,
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
          kind: "image",
          src: "/docs-assets/architecture/diagrams/acs-flow.svg",
          alt: "ACS flow showing input, pre-tool, and post-tool checks",
          caption:
            "The policy can stop the input, stop or escalate a tool call, or transform the tool result.",
        },
        {
          kind: "chain",
          label: "Policy points",
          items: ["input", "pre_tool_call", "post_tool_call"],
        },
        {
          kind: "launch",
          links: [{ label: "Architecture diagrams", href: "/#/docs/architecture/diagram.md" }],
        },
      ],
      notes: {
        minutes: 3,
        surface: "slides",
        say: [
          "There are three places to intervene: before the model output becomes a tool call, before the tool runs, and after the tool returns.",
          "That gives allow, deny, escalate, and transform decisions.",
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
        minutes: 3,
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
          text: "The LLM judge and fraud classifier are simple keyword stand-ins for demo purposes.",
        },
        {
          kind: "honest",
          text: "Foundry evaluators are shown as a trust-stack layer, but they are not wired into this app.",
        },
        {
          kind: "honest",
          text: "Practice mode exists so a live talk can continue safely if the model or service is unavailable.",
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Governance work should be honest about where controls live.",
          "This demo centralizes the policy so we can see it clearly.",
          "Production systems should still enforce hard limits in the bank API too.",
        ],
      },
    },
    {
      id: "assert-tests",
      chip: "Tests",
      title: "Testing the promises: ASSERT and policy regression",
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
      id: "observability",
      chip: "Evidence",
      title: "Proof in the portal: one answer, end to end",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Trace ID follows one answer from browser to API to model call to policy checks and tools.",
            "Conversation ID ties a whole chat together.",
            "No prompt text is stored in telemetry.",
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
        minutes: 4,
        surface: "observability",
        say: [
          "Runtime evidence is the fourth layer.",
          "We want to answer what happened, in which conversation, and why policy decided that.",
          "The Azure portal cannot be framed, so open it in its own window.",
        ],
        do: [
          "Under an answer, open **IDs and observability links**.",
          "Copy or point to **Trace ID** and **Conversation ID**.",
          "Open **This answer in Logs**.",
          "Open **Answer review workbook**.",
          "Open **Governed AI Bank Assistant — telemetry (bankgov)** or dashboard **Governed AI Bank Assistant (bankgov)**.",
        ],
        watch: [
          "One trace links browser, API, model call, policy checks, and tools.",
          "The workbook shows review fields without logging prompt text.",
        ],
        fallback: [
          "If portal access is not ready, keep the app on screen and describe the Trace ID and Conversation ID path.",
          "Say the portal requires Monitoring Reader and Workbook Reader.",
        ],
      },
    },
    {
      id: "trust-compliance",
      chip: "Trust",
      title: "Trust and compliance built in",
      blocks: [
        {
          kind: "cards",
          columns: 3,
          items: [
            {
              title: "Managed Identity",
              text: "The app reaches Azure resources without storing keys.",
              tone: "success",
            },
            {
              title: "Private model endpoint",
              text: "The model endpoint is private in the deployed architecture.",
              tone: "success",
            },
            {
              title: "Synthetic data",
              text: "No real customers, money, or bank system are connected.",
              tone: "info",
            },
            { title: "Content filters", text: "Azure AI content filters are on.", tone: "success" },
            {
              title: "HTTPS domain",
              text: "The public site uses an HTTPS-only custom domain.",
              tone: "success",
            },
            {
              title: "No prompt logs",
              text: "Telemetry records operational data, not prompt text.",
              tone: "info",
            },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "Agent governance does not replace platform security.",
          "The demo also uses managed identity, private endpoint design, content filters, synthetic data, and HTTPS.",
          "Each layer reduces a different risk.",
        ],
      },
    },
    {
      id: "cost",
      chip: "Cost",
      title: "What it costs",
      blocks: [
        {
          kind: "cards",
          columns: 3,
          items: [
            {
              title: "Monthly",
              text: "About USD 15-20 per month for the low-traffic demo.",
              tone: "info",
            },
            { title: "GPT-4.1", text: "About USD 0.001 per request.", tone: "accent" },
            { title: "GPT-4.1 mini", text: "About USD 0.0002 per request.", tone: "accent" },
          ],
        },
        {
          kind: "launch",
          links: [
            {
              label: "Cost notes",
              href: "https://github.com/michaelsrichter/bank-manager-standalone/blob/main/docs/cost/cost-to-run.md",
            },
          ],
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "The governance layer here is not the cost driver.",
          "For this low-traffic demo, the steady monthly cost is mostly hosting and observability.",
          "The per-request model cost is small, but still visible.",
        ],
      },
    },
    {
      id: "start",
      chip: "Start",
      title: "How to start",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "Fork the repo",
              text: "Start from a working reference instead of a blank page.",
            },
            {
              title: "Install the Agent Governance Toolkit",
              text: "Use `pip install` for the toolkit and ACS package used by your app.",
            },
            { title: "Write one policy", text: "Begin with one role, one tool, and one rule." },
            {
              title: "Test both ways",
              text: "Prove allowed work still succeeds and denied work still fails.",
            },
            { title: "Wire telemetry", text: "Keep the evidence trail from day one." },
            {
              title: "Start read-only",
              text: "Add money movement or write tools only after governance is tested.",
            },
          ],
        },
      ],
      notes: {
        minutes: 2,
        surface: "slides",
        say: [
          "The practical starting point is small.",
          "Pick one tool and one written rule.",
          "Make that rule visible in tests and telemetry before adding more power.",
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
          text: "Building intelligence with agents is the easier half. Governance deserves equal or more focus.",
        },
        {
          kind: "lead",
          text: "A trust platform is a trust dashboard plus policy-driven governance.",
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "The talk has one message.",
          "Use the model for intelligence, but use policy, tests, and evidence for trust.",
          "That is how an assistant becomes governable.",
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
          text: "Scan the demo QR code to open the public site. Scan the presenter QR code if the presenter added one.",
        },
      ],
      notes: {
        minutes: 1,
        surface: "slides",
        say: [
          "Thank you. Please scan the QR code to try the demo.",
          "If I added a presenter link, the second QR code is mine.",
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
