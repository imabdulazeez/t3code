import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type {
  BranchNameGenerationInput,
  CommitMessageGenerationInput,
  PrContentGenerationInput,
  ProviderTextGeneration,
  ThreadTitleGenerationInput,
} from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

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
    Effect.catchTags({
      TextGenerationError: (primaryError) =>
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
    }),
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
