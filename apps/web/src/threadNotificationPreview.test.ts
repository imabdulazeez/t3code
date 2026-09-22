import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./lib/runtime", () => ({ runtime: {} }));
vi.mock("./rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("./state/session", () => ({ environmentSession: {}, readPreparedConnection: () => null }));

import { completionMessagePreview } from "./threadNotificationPreview";

const turnId = TurnId.make("turn-1");
const message = (
  text: string,
  overrides: Partial<OrchestrationMessage> = {},
): OrchestrationMessage => ({
  id: MessageId.make("message-1"),
  role: "assistant",
  text,
  turnId,
  streaming: false,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
  ...overrides,
});

describe("completion message previews", () => {
  it("uses the last finished assistant response from the completed turn", () => {
    expect(
      completionMessagePreview(
        [
          message("Earlier reply"),
          message("## Fixed **login**\n\nSee [the change](https://example.com)."),
          message("User text", { role: "user" }),
          message("Reasoning", { role: "system" }),
          message("Still writing", { streaming: true }),
          message("Another turn", { turnId: TurnId.make("turn-2") }),
        ],
        turnId,
      ),
    ).toBe("Fixed login See the change.");
  });

  it("falls back when the completed turn has no assistant text", () => {
    expect(
      completionMessagePreview([message("Old response", { turnId: TurnId.make("old") })], turnId),
    ).toBe("Thread completed");
    expect(completionMessagePreview([message("   ")], turnId)).toBe("Thread completed");
  });

  it("caps a long response at 200 characters", () => {
    const preview = completionMessagePreview([message("a".repeat(300))], turnId);
    expect(preview).toBe(`${"a".repeat(199)}…`);
  });
});
