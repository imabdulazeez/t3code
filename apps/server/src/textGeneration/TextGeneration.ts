import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  fallbackModelSelection?: ModelSelection | null | undefined;
  /** Custom prompt instructions to replace the built-in ones. */
  instructionsOverride?: string | undefined;
  /** Custom branch-name instructions, applied only when `includeBranch` is set. */
  branchInstructionsOverride?: string | undefined;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  fallbackModelSelection?: ModelSelection | null | undefined;
  /** Custom prompt instructions to replace the built-in ones. */
  instructionsOverride?: string | undefined;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  fallbackModelSelection?: ModelSelection | null | undefined;
  /** Custom prompt instructions to replace the built-in ones. */
  instructionsOverride?: string | undefined;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  fallbackModelSelection?: ModelSelection | null | undefined;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /**
     * Generate a commit message from staged change context.
     */
    readonly generateCommitMessage: (
      input: CommitMessageGenerationInput,
    ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

    /**
     * Generate change request title/body from branch and diff context.
     */
    readonly generatePrContent: (
      input: PrContentGenerationInput,
    ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;
  }
>()("t3/textGeneration/TextGeneration") {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

const withFallback = <
  Input extends {
    modelSelection: ModelSelection;
    fallbackModelSelection?: ModelSelection | null | undefined;
  },
  Output,
>(
  operation: TextGenerationOp,
  input: Input,
  run: (input: Input) => Effect.Effect<Output, TextGenerationError>,
): Effect.Effect<Output, TextGenerationError> => {
  const fallback = input.fallbackModelSelection;
  if (!fallback) {
    return run(input);
  }
  return run(input).pipe(
    Effect.catchTag("TextGenerationError", (primaryError) =>
      Effect.logWarning("text generation falling back to secondary model", {
        operation,
        primary: `${input.modelSelection.instanceId}/${input.modelSelection.model}`,
        fallback: `${fallback.instanceId}/${fallback.model}`,
        detail: primaryError.detail,
      }).pipe(
        Effect.andThen(
          run({ ...input, modelSelection: fallback, fallbackModelSelection: null }).pipe(
            Effect.mapError(
              (fallbackError) =>
                new TextGenerationError({
                  operation,
                  detail: `${fallbackError.detail} (primary model failed: ${primaryError.detail})`,
                  cause: primaryError,
                }),
            ),
          ),
        ),
      ),
    ),
  );
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const runCommitMessage = (input: CommitMessageGenerationInput) =>
    resolveInstance(registry, "generateCommitMessage", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input)),
    );
  const runPrContent = (input: PrContentGenerationInput) =>
    resolveInstance(registry, "generatePrContent", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input)),
    );
  const runBranchName = (input: BranchNameGenerationInput) =>
    resolveInstance(registry, "generateBranchName", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
    );
  const runThreadTitle = (input: ThreadTitleGenerationInput) =>
    resolveInstance(registry, "generateThreadTitle", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
    );
  return TextGeneration.of({
    generateCommitMessage: (input) =>
      withFallback("generateCommitMessage", input, runCommitMessage),
    generatePrContent: (input) => withFallback("generatePrContent", input, runPrContent),
    generateBranchName: (input) => withFallback("generateBranchName", input, runBranchName),
    generateThreadTitle: (input) =>
      Effect.gen(function* () {
        const linkedContext =
          input.linkedContext ??
          (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
            Effect.provideService(
              SourceControlProviderRegistry.SourceControlProviderRegistry,
              sourceControl,
            ),
          ));
        return yield* withFallback(
          "generateThreadTitle",
          { ...input, linkedContext },
          runThreadTitle,
        );
      }),
  });
});

export const layer = Layer.effect(TextGeneration, make);
