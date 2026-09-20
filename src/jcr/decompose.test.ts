import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { decomposeRequest } from "./decompose.js";

test("decomposes with GPT-5.6 Luna in fast mode", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "gpt-5.6-luna",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                steps: ["Create a Stripe customer.", "Post its link in Slack."],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      }),
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const environment = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    JCR_OPENAI_MODEL: process.env.JCR_OPENAI_MODEL,
  };
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  delete process.env.JCR_OPENAI_MODEL;

  try {
    const result = await decomposeRequest(
      "Create a Stripe customer, then post its link in Slack.",
    );

    assert.equal(requestBody?.model, "gpt-5.6-luna");
    assert.equal(requestBody?.service_tier, "fast");
    assert.deepEqual(result.steps, [
      "Create a Stripe customer.",
      "Post its link in Slack.",
    ]);
    assert.deepEqual(result.metrics, {
      model: "gpt-5.6-luna",
      calls: 1,
      inputTokens: 12,
      cachedInputTokens: 0,
      outputTokens: 8,
    });
  } finally {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
