import { Layer, ManagedRuntime } from "effect";

import { Corpus } from "../features/question-finder/services/corpus";
import type { Discord } from "../features/question-finder/services/discord";
import type { Judge } from "../features/question-finder/services/judge";
import { ProjectStorage } from "../features/question-finder/services/projectStorage";

export const createProjectHarvestRuntime = (
  storage: DurableObjectStorage,
  discord: Layer.Layer<Discord>,
  judge: Layer.Layer<Judge>
) =>
  ManagedRuntime.make(
    Layer.mergeAll(ProjectStorage.layer(storage), discord, judge, Corpus.stub)
  );
