import { RunId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./lib/runtime", () => ({ runtime: {} }));
vi.mock("./state/session", () => ({ readPreparedConnection: () => null }));

import { completionMessagePreview } from "./threadNotificationPreview";

const runId = RunId.make("run-1");
const message = (
  text: string,
  overrides: Partial<Parameters<typeof completionMessagePreview>[0][number]> = {},
) => ({
  role: "assistant" as const,
  text,
  runId,
  streaming: false,
  ...overrides,
});

describe("completion message previews", () => {
  it("uses the last finished assistant response from the completed run", () => {
    expect(
      completionMessagePreview(
        [
          message("Earlier reply"),
          message("## Fixed **login**\n\nSee [the change](https://example.com)."),
          message("User text", { role: "user" }),
          message("Reasoning", { role: "system" }),
          message("Still writing", { streaming: true }),
          message("Another run", { runId: RunId.make("run-2") }),
        ],
        runId,
      ),
    ).toBe("Fixed login See the change.");
  });

  it("falls back when the completed run has no assistant text", () => {
    expect(
      completionMessagePreview([message("Old response", { runId: RunId.make("old") })], runId),
    ).toBe("Thread completed");
    expect(completionMessagePreview([message("   ")], runId)).toBe("Thread completed");
  });

  it("ends a long response at the last complete sentence", () => {
    expect(
      completionMessagePreview(
        [
          message(
            "The other agent is correct on the main point, and my previous answer was wrong about the write endpoint. I described PUT /v2/companies as the route.",
          ),
        ],
        runId,
      ),
    ).toBe(
      "The other agent is correct on the main point, and my previous answer was wrong about the write endpoint.",
    );
  });

  it("cuts a long response without a sentence break at a word boundary", () => {
    expect(completionMessagePreview([message("word ".repeat(40))], runId)).toBe(
      `${"word ".repeat(28).trimEnd()}…`,
    );
    expect(completionMessagePreview([message("a".repeat(300))], runId)).toBe(`${"a".repeat(139)}…`);
  });

  it("drops fenced code blocks", () => {
    expect(
      completionMessagePreview([message("Run this:\n\n```sh\nvp test\n```\n\nThen retry.")], runId),
    ).toBe("Run this: Then retry.");
  });
});
