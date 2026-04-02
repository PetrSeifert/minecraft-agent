import type { ExecutorDecision, JsonValue, OrchestrationSnapshot } from "../types";

const DEFAULT_TEMPERATURE = 0.1;

const SYSTEM_PROMPT = [
  "You are executing one next Minecraft bot step toward the current goal.",
  "Always choose exactly one tool call.",
  "Keep actions local, concrete, and achievable from the current snapshot.",
  "Prioritize survival over the current goal.",
  "Use wait when more information or time is needed.",
  "Use mark_goal_complete only when the goal is already satisfied.",
  "Use mark_goal_blocked only when the goal cannot currently progress with available nearby options.",
].join(" ");

interface OpenRouterToolDefinition {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

interface ExecutorRequestOptions {
  includeParallelToolCalls: boolean;
  includeToolChoice: boolean;
}

interface ChatCompletionToolCall {
  function?: {
    arguments?: string;
    name?: string;
  };
  id?: string;
  type?: string;
}

interface ChatCompletionMessage {
  content?: string | Array<{ text?: string; type?: string }>;
  tool_calls?: ChatCompletionToolCall[];
}

interface ChatCompletionChoice {
  message?: ChatCompletionMessage;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
}

interface OpenRouterModelMetadata {
  id?: string;
  supported_parameters?: string[];
}

interface ParsedResponseBody {
  payload: ChatCompletionResponse | null;
  rawBody: string;
}

interface ModelsResponseBody {
  data?: OpenRouterModelMetadata[];
}

export interface OpenRouterExecutorClient {
  chooseTool(
    snapshot: OrchestrationSnapshot,
    tools: OpenRouterToolDefinition[],
  ): Promise<ExecutorDecision>;
  ensureToolSupport(): Promise<void>;
  readonly model: string;
  readonly provider: "openrouter";
}

export interface OpenRouterExecutorClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type FetchLike = typeof fetch;

function validateClientConfig(config: OpenRouterExecutorClientConfig): void {
  if (!config.apiKey.trim()) {
    throw new Error("OpenRouter API key is not configured");
  }

  if (!config.model.trim()) {
    throw new Error("OpenRouter model is not configured");
  }
}

function truncateBody(text: string, limit = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function buildHttpErrorMessage(parsedBody: ParsedResponseBody, status: number): string {
  const message = parsedBody.payload?.error?.message?.trim();

  if (message) {
    return `OpenRouter request failed (${status}): ${message}`;
  }

  const snippet = truncateBody(parsedBody.rawBody);
  return snippet
    ? `OpenRouter request failed (${status}): ${snippet}`
    : `OpenRouter request failed (${status})`;
}

async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    return {
      payload: null,
      rawBody,
    };
  }

  try {
    return {
      payload: JSON.parse(rawBody) as ChatCompletionResponse,
      rawBody,
    };
  } catch {
    return {
      payload: null,
      rawBody,
    };
  }
}

function buildUserPrompt(snapshot: OrchestrationSnapshot): string {
  return JSON.stringify({
    instructions: {
      responseMode: "tool_call_only",
      stepBudget: 1,
    },
    snapshot,
  });
}

function buildRequestBody(
  config: OpenRouterExecutorClientConfig,
  snapshot: OrchestrationSnapshot,
  tools: OpenRouterToolDefinition[],
  options: ExecutorRequestOptions,
): Record<string, unknown> {
  return {
    model: config.model,
    ...(options.includeParallelToolCalls ? { parallel_tool_calls: false } : {}),
    temperature: DEFAULT_TEMPERATURE,
    ...(options.includeToolChoice ? { tool_choice: "required" } : {}),
    tools: tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(snapshot),
      },
    ],
  };
}

function parseToolArguments(rawArguments: string | undefined): JsonValue {
  if (!rawArguments?.trim()) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawArguments);
  } catch (error: unknown) {
    throw new Error(
      `OpenRouter tool arguments were not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenRouter tool arguments must be a JSON object");
  }

  return parsed as JsonValue;
}

function parseToolDecision(
  payload: ChatCompletionResponse,
  toolNames: Set<string>,
): ExecutorDecision {
  const toolCalls = payload.choices?.[0]?.message?.tool_calls ?? [];

  if (toolCalls.length !== 1) {
    throw new Error(
      `OpenRouter executor must return exactly one tool call, received ${toolCalls.length}`,
    );
  }

  const toolCall = toolCalls[0];
  const toolName = toolCall?.function?.name?.trim();

  if (!toolName) {
    throw new Error("OpenRouter executor response was missing a tool name");
  }

  if (!toolNames.has(toolName)) {
    throw new Error(`OpenRouter executor requested unknown tool: ${toolName}`);
  }

  return {
    args: parseToolArguments(toolCall.function?.arguments),
    tool: toolName,
  };
}

function parseModelsPayload(payload: unknown): OpenRouterModelMetadata[] {
  if (Array.isArray(payload)) {
    return payload as OpenRouterModelMetadata[];
  }

  if (payload && typeof payload === "object") {
    const models = (payload as ModelsResponseBody).data;
    return Array.isArray(models) ? models : [];
  }

  return [];
}

function validateModelCapabilities(model: string, models: OpenRouterModelMetadata[]): void {
  const metadata = models.find((candidate) => candidate.id === model);

  if (!metadata) {
    throw new Error(`OpenRouter model metadata not found for "${model}"`);
  }

  const supportedParameters = Array.isArray(metadata.supported_parameters)
    ? metadata.supported_parameters
    : [];

  const requiredParameters = ["tools", "tool_choice"];
  const missing = requiredParameters.filter(
    (parameter) => !supportedParameters.includes(parameter),
  );

  if (missing.length > 0) {
    throw new Error(
      `OpenRouter model "${model}" does not support required parameters: ${missing.join(", ")}`,
    );
  }
}

function isNoEndpointsError(response: Response, parsedBody: ParsedResponseBody): boolean {
  return (
    response.status === 404 &&
    /No endpoints found that can handle the requested parameters/i.test(
      parsedBody.rawBody || parsedBody.payload?.error?.message || "",
    )
  );
}

export function createOpenRouterExecutorClient(
  config: OpenRouterExecutorClientConfig,
  fetchImpl: FetchLike = fetch,
): OpenRouterExecutorClient {
  async function ensureToolSupport(): Promise<void> {
    validateClientConfig(config);

    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(
        truncateBody(rawBody)
          ? `OpenRouter model lookup failed (${response.status}): ${truncateBody(rawBody)}`
          : `OpenRouter model lookup failed (${response.status})`,
      );
    }

    let parsed: unknown;

    try {
      parsed = rawBody.trim() ? JSON.parse(rawBody) : null;
    } catch (error: unknown) {
      throw new Error(
        `OpenRouter model lookup was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    validateModelCapabilities(config.model, parseModelsPayload(parsed));
  }

  async function chooseTool(
    snapshot: OrchestrationSnapshot,
    tools: OpenRouterToolDefinition[],
  ): Promise<ExecutorDecision> {
    validateClientConfig(config);
    const requestVariants: ExecutorRequestOptions[] = [
      {
        includeParallelToolCalls: true,
        includeToolChoice: true,
      },
      {
        includeParallelToolCalls: false,
        includeToolChoice: true,
      },
      {
        includeParallelToolCalls: false,
        includeToolChoice: false,
      },
    ];
    let lastParsedBody: ParsedResponseBody | null = null;
    let lastStatus: number | null = null;

    for (const variant of requestVariants) {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(config, snapshot, tools, variant)),
      });
      const parsedBody = await parseResponseBody(response);

      lastParsedBody = parsedBody;
      lastStatus = response.status;

      if (!response.ok) {
        if (isNoEndpointsError(response, parsedBody)) {
          continue;
        }

        throw new Error(buildHttpErrorMessage(parsedBody, response.status));
      }

      if (!parsedBody.payload) {
        throw new Error("OpenRouter response was not valid JSON: expected a JSON object body");
      }

      return parseToolDecision(parsedBody.payload, new Set(tools.map((tool) => tool.name)));
    }

    throw new Error(
      buildHttpErrorMessage(lastParsedBody ?? { payload: null, rawBody: "" }, lastStatus ?? 500),
    );
  }

  return {
    ensureToolSupport,
    chooseTool,
    model: config.model,
    provider: "openrouter",
  };
}

export const openRouterExecutorClientInternals = {
  buildRequestBody,
  buildUserPrompt,
  isNoEndpointsError,
  parseModelsPayload,
  parseToolArguments,
  parseToolDecision,
  truncateBody,
  validateModelCapabilities,
};
