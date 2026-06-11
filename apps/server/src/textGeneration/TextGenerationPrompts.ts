/**
 * Shared prompt builders for text generation providers.
 *
 * Extracts the prompt construction logic that is identical across
 * Codex, Claude, and any future CLI-based text generation backends.
 *
 * @module textGenerationPrompts
 */
import * as Schema from "effect/Schema";
import type { ChatAttachment } from "@t3tools/contracts";

import { limitSection } from "./TextGenerationUtils.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

function policyInstruction(instruction: string | undefined): ReadonlyArray<string> {
  const trimmed = instruction?.trim();
  return trimmed ? ["", "Additional instructions:", limitSection(trimmed, 4_000)] : [];
}

function buildPromptSections(input: {
  instructions: ReadonlyArray<string>;
  instructionsOverride: string | undefined;
  requiredInstructions?: ReadonlyArray<string>;
  contractLine: string;
  contextLines: ReadonlyArray<string>;
}): string {
  const override = input.instructionsOverride?.trim();
  const instructionLines = override ? [override] : input.instructions;
  return [
    ...instructionLines,
    ...(input.requiredInstructions ?? []),
    input.contractLine,
    ...input.contextLines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Commit message
// ---------------------------------------------------------------------------

export interface CommitMessagePromptInput {
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch: boolean;
  policy?: TextGenerationPolicy | undefined;
  instructionsOverride?: string | undefined;
}

export function buildCommitMessagePrompt(input: CommitMessagePromptInput) {
  const wantsBranch = input.includeBranch;

  const instructions = [
    "You write concise git commit messages.",
    "Rules:",
    "- subject must be imperative, <= 72 chars, and no trailing period",
    "- body can be empty string or short bullet points",
    "- capture the primary user-visible or developer-visible change",
  ];

  const requiredInstructions = wantsBranch
    ? [
        "- branch must be a short semantic git branch fragment for this change; never reuse the current branch name or a remote ref like origin/<branch>",
      ]
    : [];

  const contractLine = wantsBranch
    ? "Return a JSON object with keys: subject, body, branch."
    : "Return a JSON object with keys: subject, body.";

  const contextLines = [
    ...policyInstruction(input.instructionsOverride ? undefined : input.policy?.commitInstructions),
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.stagedSummary, 6_000),
    "",
    "Staged patch:",
    limitSection(input.stagedPatch, 40_000),
  ];

  const prompt = buildPromptSections({
    instructions,
    instructionsOverride: input.instructionsOverride,
    requiredInstructions,
    contractLine,
    contextLines,
  });

  if (wantsBranch) {
    return {
      prompt,
      outputSchema: Schema.Struct({
        subject: Schema.String,
        body: Schema.String,
        branch: Schema.String,
      }),
    };
  }

  return {
    prompt,
    outputSchema: Schema.Struct({
      subject: Schema.String,
      body: Schema.String,
    }),
  };
}

// ---------------------------------------------------------------------------
// PR content
// ---------------------------------------------------------------------------

export interface PrContentPromptInput {
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  policy?: TextGenerationPolicy | undefined;
  instructionsOverride?: string | undefined;
}

export function buildPrContentPrompt(input: PrContentPromptInput) {
  const instructions = [
    "You write GitHub pull request content.",
    "Rules:",
    "- title should be concise and specific",
    "- body must be markdown and include headings '## Summary' and '## Testing'",
    "- body must be plain markdown text only — do NOT wrap it in JSON, code fences, or repeat the title/body keys inside the body",
    "- do NOT serialize the response as a string inside a field; the title and body fields receive their literal values directly",
    "- under Summary, provide short bullet points",
    "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
  ];

  const contractLine = "Return a JSON object with keys: title, body.";

  const contextLines = [
    ...policyInstruction(
      input.instructionsOverride ? undefined : input.policy?.changeRequestInstructions,
    ),
    "",
    `Base branch: ${input.baseBranch}`,
    `Head branch: ${input.headBranch}`,
    "",
    "Commits:",
    limitSection(input.commitSummary, 12_000),
    "",
    "Diff stat:",
    limitSection(input.diffSummary, 12_000),
    "",
    "Diff patch:",
    limitSection(input.diffPatch, 40_000),
  ];

  const prompt = buildPromptSections({
    instructions,
    instructionsOverride: input.instructionsOverride,
    contractLine,
    contextLines,
  });

  const outputSchema = Schema.Struct({
    title: Schema.String,
    body: Schema.String,
  });

  return { prompt, outputSchema };
}

// ---------------------------------------------------------------------------
// Branch name
// ---------------------------------------------------------------------------

export interface BranchNamePromptInput {
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  policy?: TextGenerationPolicy | undefined;
  instructionsOverride?: string | undefined;
}

interface PromptFromMessageInput {
  instruction: string;
  responseShape: string;
  rules: ReadonlyArray<string>;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  additionalInstructions?: string | undefined;
  instructionsOverride?: string | undefined;
}

function buildPromptFromMessage(input: PromptFromMessageInput): string {
  const attachmentLines = (input.attachments ?? []).map(
    (attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
  );

  const instructions = [input.instruction, "Rules:", ...input.rules.map((rule) => `- ${rule}`)];
  const contractLine = input.responseShape;

  const contextLines = [
    ...policyInstruction(input.instructionsOverride ? undefined : input.additionalInstructions),
    "",
    "User message:",
    limitSection(input.message, 8_000),
  ];

  if (attachmentLines.length > 0) {
    contextLines.push("", "Attachment metadata:", limitSection(attachmentLines.join("\n"), 4_000));
  }

  return buildPromptSections({
    instructions,
    instructionsOverride: input.instructionsOverride,
    contractLine,
    contextLines,
  });
}

export function buildBranchNamePrompt(input: BranchNamePromptInput) {
  const prompt = buildPromptFromMessage({
    instruction: "You generate concise git branch names.",
    responseShape: "Return a JSON object with key: branch.",
    rules: [
      "Branch should describe the requested work from the user message.",
      "Keep it short and specific (2-6 words).",
      "Use plain words only, no issue prefixes and no punctuation-heavy text.",
      "If images are attached, use them as primary context for visual/UI issues.",
    ],
    message: input.message,
    attachments: input.attachments,
    additionalInstructions: input.policy?.branchInstructions,
    instructionsOverride: input.instructionsOverride,
  });
  const outputSchema = Schema.Struct({
    branch: Schema.String,
  });

  return { prompt, outputSchema };
}

// ---------------------------------------------------------------------------
// Thread title
// ---------------------------------------------------------------------------

export interface ThreadTitlePromptInput {
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  policy?: TextGenerationPolicy | undefined;
}

export function buildThreadTitlePrompt(input: ThreadTitlePromptInput) {
  const prompt = buildPromptFromMessage({
    instruction: "You write concise thread titles for coding conversations.",
    responseShape: "Return a JSON object with key: title.",
    rules: [
      "Title should summarize the user's request, not restate it verbatim.",
      "Keep it short and specific (3-8 words).",
      "Avoid quotes, filler, prefixes, and trailing punctuation.",
      "If images are attached, use them as primary context for visual/UI issues.",
    ],
    message: input.message,
    attachments: input.attachments,
    additionalInstructions: input.policy?.threadTitleInstructions,
  });
  const outputSchema = Schema.Struct({
    title: Schema.String,
  });

  return { prompt, outputSchema };
}
