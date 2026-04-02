import type { OrchestrationSnapshot } from "../types";

const DEFAULT_TEMPERATURE = 0.2;
const MAX_GOAL_LENGTH = 120;
const SYSTEM_PROMPT = [
  "You are planning the next high-level Minecraft bot goal.",
  "Prioritize survival first, then food, shelter, and basic resources.",
  "Prefer goals that are achievable from the current nearby world state.",
  "Avoid long multi-step objectives and avoid depending on unseen tools or distant locations.",
  'Return valid JSON with exactly one field: "goal".',
  "The goal must be a concise plain-text string.",
].join(" ");

interface ChatCompletionMessage {
  content?: string | Array<{ text?: string; type?: string }>;
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

interface ParsedResponseBody {
  payload: ChatCompletionResponse | null;
  rawBody: string;
}

export interface OpenRouterGoalClient {
  chooseGoal(snapshot: OrchestrationSnapshot): Promise<string>;
  readonly model: string;
  readonly provider: "openrouter";
}

export interface OpenRouterClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type FetchLike = typeof fetch;

function buildUserPrompt(snapshot: OrchestrationSnapshot): string {
  return JSON.stringify({
    instructions: {
      maxGoalLength: MAX_GOAL_LENGTH,
      responseShape: {
        goal: "string",
      },
    },
    snapshot,
  });
}

function truncateBody(text: string, limit = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function validateClientConfig(config: OpenRouterClientConfig): void {
  if (!config.apiKey.trim()) {
    throw new Error("OpenRouter API key is not configured");
  }

  if (!config.model.trim()) {
    throw new Error("OpenRouter model is not configured");
  }
}

function extractMessageContent(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  throw new Error("OpenRouter response did not include message content");
}

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? text.trim();
}

function parseGoalResponse(text: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (error: unknown) {
    throw new Error(
      `OpenRouter response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenRouter response JSON must be an object");
  }

  const keys = Object.keys(parsed);

  if (keys.length !== 1 || keys[0] !== "goal") {
    throw new Error('OpenRouter response JSON must contain exactly one "goal" field');
  }

  const goal =
    typeof (parsed as { goal?: unknown }).goal === "string"
      ? (parsed as { goal: string }).goal.trim()
      : "";

  if (!goal) {
    throw new Error("OpenRouter goal must be a non-empty string");
  }

  if (goal.length > MAX_GOAL_LENGTH) {
    throw new Error(`OpenRouter goal must be ${MAX_GOAL_LENGTH} characters or fewer`);
  }

  return goal;
}

function buildErrorMessage(responsePayload: ChatCompletionResponse, status: number): string {
  const message = responsePayload.error?.message?.trim();
  return message
    ? `OpenRouter request failed (${status}): ${message}`
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

function buildHttpErrorMessage(parsedBody: ParsedResponseBody, status: number): string {
  if (parsedBody.payload) {
    return buildErrorMessage(parsedBody.payload, status);
  }

  const snippet = truncateBody(parsedBody.rawBody);
  return snippet
    ? `OpenRouter request failed (${status}): ${snippet}`
    : `OpenRouter request failed (${status})`;
}

export function createOpenRouterGoalClient(
  config: OpenRouterClientConfig,
  fetchImpl: FetchLike = fetch,
): OpenRouterGoalClient {
  async function chooseGoal(snapshot: OrchestrationSnapshot): Promise<string> {
    validateClientConfig(config);

    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: DEFAULT_TEMPERATURE,
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
      }),
    });
    const parsedBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(buildHttpErrorMessage(parsedBody, response.status));
    }

    if (!parsedBody.payload) {
      throw new Error("OpenRouter response was not valid JSON: expected a JSON object body");
    }

    return parseGoalResponse(extractMessageContent(parsedBody.payload));
  }

  return {
    provider: "openrouter",
    model: config.model,
    chooseGoal,
  };
}

export const openRouterClientInternals = {
  buildHttpErrorMessage,
  buildUserPrompt,
  extractMessageContent,
  parseResponseBody,
  parseGoalResponse,
  stripCodeFence,
  truncateBody,
  validateClientConfig,
};
