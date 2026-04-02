import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createOpenRouterExecutorClient,
  openRouterExecutorClientInternals,
} from "../src/llm/openRouterExecutorClient";

import type { OrchestrationSnapshot } from "../src/types";

function createSnapshot(): OrchestrationSnapshot {
  return {
    memory: {
      longTerm: [],
      shortTerm: {
        events: [],
        summaries: [],
      },
      working: [],
    },
    perception: {
      containers: [],
      hostiles: [],
      nearbyBlocks: ["oak_log"],
      nearbyEntities: [],
      recentChat: [],
      recentEvents: [],
      shelters: [],
      visibleArea: {
        focus: {
          blockAtCursor: null,
          entityAtCursor: null,
        },
        hazards: [],
        heading: {
          cardinal: "south",
          pitch: 0,
          yaw: 0,
        },
        highlights: [],
        visibleBlocks: [],
        visibleEntities: [],
      },
    },
    planning: {
      currentGoal: "find some food to eat",
      currentSkill: undefined,
      executor: null,
      planner: null,
      plan: [],
      recentFailures: [],
    },
    self: {
      biome: "plains",
      equipped: [],
      health: 20,
      hunger: 10,
      inventory: {},
      position: { x: 0, y: 64, z: 0 },
      risk: "low",
      timeOfDay: "day",
    },
  };
}

const tools = [
  {
    description: "Inspect the current visible area.",
    name: "inspect_visible_area",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

test("OpenRouter executor client sends required tool-calling request fields and parses one tool call", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const client = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async (url, init) => {
      requests.push({
        init,
        url: String(url),
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"max_distance":8}',
                      name: "inspect_visible_area",
                    },
                    id: "call_1",
                    type: "function",
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  );

  const decision = await client.chooseTool(createSnapshot(), tools);

  assert.deepEqual(decision, {
    args: {
      max_distance: 8,
    },
    tool: "inspect_visible_area",
  });
  assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");

  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.model, "openrouter/test-model");
  assert.equal(body.tool_choice, "required");
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.tools[0].function.name, "inspect_visible_area");
  assert.match(body.messages[1].content, /"snapshot":/);
});

test("OpenRouter executor client retries with a relaxed request when routing rejects strict parameters", async () => {
  let callCount = 0;
  const requests: Array<Record<string, unknown>> = [];
  const client = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async (_url, init) => {
      callCount += 1;
      requests.push(JSON.parse(String(init?.body)));

      if (callCount < 3) {
        return new Response(
          JSON.stringify({
            error: {
              message: "No endpoints found that can handle the requested parameters",
            },
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{}",
                      name: "inspect_visible_area",
                    },
                    id: "call_1",
                    type: "function",
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  );

  const decision = await client.chooseTool(createSnapshot(), tools);

  assert.equal(decision.tool, "inspect_visible_area");
  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.tool_choice, "required");
  assert.equal(requests[0]?.parallel_tool_calls, false);
  assert.equal(requests[1]?.tool_choice, "required");
  assert.equal("parallel_tool_calls" in requests[1], false);
  assert.equal("tool_choice" in requests[2], false);
});

test("OpenRouter executor client validates tool support through model metadata", async () => {
  const supportedClient = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "openrouter/test-model",
              supported_parameters: ["tools", "tool_choice"],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  await supportedClient.ensureToolSupport();

  const unsupportedClient = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "openrouter/test-model",
              supported_parameters: ["tools"],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  await assert.rejects(
    () => unsupportedClient.ensureToolSupport(),
    /does not support required parameters: tool_choice/,
  );
});

test("OpenRouter executor client rejects multiple tool calls, malformed args, and unknown tools", async () => {
  const multipleCallClient = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{}",
                      name: "inspect_visible_area",
                    },
                  },
                  {
                    function: {
                      arguments: "{}",
                      name: "wait",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  await assert.rejects(
    () => multipleCallClient.chooseTool(createSnapshot(), tools),
    /exactly one tool call/,
  );

  const malformedArgsClient = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{not-json}",
                      name: "inspect_visible_area",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  await assert.rejects(
    () => malformedArgsClient.chooseTool(createSnapshot(), tools),
    /tool arguments were not valid JSON/,
  );

  const unknownToolClient = createOpenRouterExecutorClient(
    {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/test-model",
    },
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{}",
                      name: "unknown_tool",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  await assert.rejects(
    () => unknownToolClient.chooseTool(createSnapshot(), tools),
    /requested unknown tool/,
  );
});

test("tool decision parser requires a single known tool call", () => {
  assert.throws(
    () =>
      openRouterExecutorClientInternals.parseToolDecision(
        {
          choices: [
            {
              message: {
                tool_calls: [],
              },
            },
          ],
        },
        new Set(["inspect_visible_area"]),
      ),
    /exactly one tool call/,
  );
});
