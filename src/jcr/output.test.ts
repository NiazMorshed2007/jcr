import assert from "node:assert/strict";
import test from "node:test";
import { renderAgentOutput } from "./output.js";
import type {
  CapabilityResolution,
  ResolvedStep,
  UnresolvedStep,
} from "./types.js";

const resolved = (
  index: number,
  step: string,
  matches: { path: string; context: string }[],
): ResolvedStep => ({
  index,
  step,
  matches: matches.map((match) => ({
    path: match.path,
    trail: [{ id: "hidden", name: "Hidden", probability: 0.9 }],
    item: {
      id: "hidden-item",
      name: "Hidden item",
      description: "Hidden routing text",
      context: match.context,
    },
    score: 0.9,
  })),
  separation: 9,
  noneProbability: 0.01,
  alternatives: [{ path: "hidden", name: "Hidden", score: 0.1 }],
  rounds: 3,
});

const unresolved = (
  index: number,
  step: string,
  reason: UnresolvedStep["reason"],
): UnresolvedStep => ({
  index,
  step,
  reason,
  node: {
    path: "payments/stripe",
    name: "Stripe",
    description: "Hidden node description",
  },
  candidates: [
    { path: "payments/stripe/customers", name: "Customers", score: 0.5 },
    {
      path: "payments/stripe/payment-methods",
      name: "Payment methods",
      score: 0.45,
    },
  ],
  rounds: 2,
});

const resolution = (
  steps: ResolvedStep[],
  unresolvedSteps: UnresolvedStep[] = [],
  compound = false,
): CapabilityResolution => ({
  request: "This request must stay hidden",
  compound,
  steps,
  unresolved: unresolvedSteps,
});

test("renders one match as only its path and context", () => {
  assert.equal(
    renderAgentOutput(
      resolution([
        resolved(0, "Create a customer", [
          {
            path: "payments/stripe/customers/create",
            context: "POST /v1/customers\nOptional: email",
          },
        ]),
      ]),
    ),
    "payments/stripe/customers/create\nPOST /v1/customers\nOptional: email",
  );
});

test("renders close matches without diagnostic fields", () => {
  const output = renderAgentOutput(
    resolution([
      resolved(0, "Update the customer", [
        {
          path: "payments/stripe/customers/update",
          context: "POST /v1/customers/{customer}",
        },
        {
          path: "payments/stripe/payment-methods/attach",
          context: "POST /v1/payment_methods/{id}/attach",
        },
      ]),
    ]),
  );
  assert.match(output, /^## 1\. Update the customer/);
  assert.match(output, /2 close matches, pick by the request:/);
  assert.match(output, /POST \/v1\/customers/);
  assert.doesNotMatch(
    output,
    /score|probability|separation|description|Hidden|request must stay hidden/,
  );
});

test("keeps compound contexts attached to their steps", () => {
  const output = renderAgentOutput(
    resolution(
      [
        resolved(0, "Create a customer", [
          { path: "stripe/create", context: "POST /v1/customers" },
        ]),
        resolved(1, "Post the link", [
          { path: "slack/post", context: "POST /api/chat.postMessage" },
        ]),
      ],
      [],
      true,
    ),
  );
  assert.equal(
    output,
    [
      "## 1. Create a customer",
      "",
      "stripe/create",
      "POST /v1/customers",
      "",
      "## 2. Post the link",
      "",
      "slack/post",
      "POST /api/chat.postMessage",
    ].join("\n"),
  );
});

test("renders ambiguous, none, and depth outcomes compactly", () => {
  assert.equal(
    renderAgentOutput(resolution([], [unresolved(0, "Choose", "ambiguous")])),
    "Ambiguous under Stripe: Customers, Payment methods. Re-call with a sharper step.",
  );
  assert.equal(
    renderAgentOutput(resolution([], [unresolved(0, "Choose", "none")])),
    "No match. Closest: Customers, Payment methods.",
  );
  assert.equal(
    renderAgentOutput(resolution([], [unresolved(0, "Choose", "depth")])),
    "Resolution stopped at Stripe. Re-call with a sharper step.",
  );
});

test("orders resolved and unresolved compound steps together", () => {
  const output = renderAgentOutput(
    resolution(
      [
        resolved(1, "Post the link", [
          { path: "slack/post", context: "POST /api/chat.postMessage" },
        ]),
      ],
      [unresolved(0, "Create a record", "none")],
      true,
    ),
  );
  assert.ok(output.indexOf("## 1.") < output.indexOf("## 2."));
});
