import {
  EFFECT_PROJECT,
  XSTATE_PROJECT,
} from "#/features/question-finder/lib/projects.config";

export const API_V10 = "https://discord.com/api/v10";
export const API = "https://discord.com/api/v9";

/** Threads a stub run treats as already answered, to the display name of the Project owner who replied. */
export const ANSWERED_THREADS: ReadonlyMap<string, string> = new Map([
  ["1525693287409913856", EFFECT_PROJECT.ownerName],
  ["1540000000000000002", XSTATE_PROJECT.ownerName],
]);
