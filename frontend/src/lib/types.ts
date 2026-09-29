export interface Pricing {
  currency: string;
  inputPer1MTokens: number;
  cachedInputPer1MTokens: number;
  outputPer1MTokens: number;
  source: string;
}

export interface ModelOption {
  key: string;
  label: string;
  deployment: string;
  model: string;
  pricing: Pricing;
}

export interface Persona {
  id: string;
  label: string;
  role: string;
  assignedAccounts: string[];
}

export interface Scenario {
  prompt: string;
  expect: string;
}

export interface AppConfig {
  models: ModelOption[];
  defaultModel: string;
  personas: Persona[];
  defaultPersona: string;
  scenarios: Scenario[];
  limits: { maxPromptChars: number; perSessionPerMinute: number };
  fakeAi: boolean;
  repoUrl: string;
}

export interface PolicyState {
  restrictedMode: boolean;
  customerApproved: boolean;
  adminMode: boolean;
}

export interface ToolAction {
  tool_name: string;
  args: Record<string, string | number>;
}

export interface LaneResult {
  lane: "baseline" | "governed";
  status: string;
  reason: string;
  message: string;
  text: string | null;
  toolExecuted: boolean;
  interventionPoint: string | null;
  policyDecision: string;
  action: ToolAction | null;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface Cost {
  currency: string;
  totalUsd: number | null;
  confidence: "estimate" | "fake" | "unavailable";
}

export type StreamEvent =
  | {
      seq: number;
      type: "run.started";
      traceId: string;
      model: { key: string; label: string; deployment: string };
    }
  | { seq: number; type: "step"; id: string; state: string; status?: string }
  | {
      seq: number;
      type: "model.usage";
      requestedDeployment: string;
      responseModel: string | null;
      usage: Usage | null;
      cost: Cost;
      durationMs: number;
      fakeAi: boolean;
    }
  | { seq: number; type: "tool.selected"; action: ToolAction | null }
  | { seq: number; type: "lane.result"; result: LaneResult }
  | { seq: number; type: "run.completed"; traceId: string }
  | { seq: number; type: "error"; code: string; message: string; traceId?: string };

export interface HealthComponent {
  name?: string | null;
  status?: string | null;
  detail?: string | null;
  critical?: boolean | null;
}

export interface HealthSnapshot {
  status?: string | null;
  ready?: boolean | null;
  checkedAt?: number | null;
  cacheSeconds?: number | null;
  components?: HealthComponent[] | null;
}
