import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import playwright from "ultracite/oxlint/playwright";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

// Both presets match `*.spec.ts` by default, and the Vitest autofix then adds a
// `vitest` import to Playwright specs. Scope each to its own directory.
const testOverrides = [
  ...(vitest.overrides ?? []).map((override) => ({
    ...override,
    files: ["src/**/__tests__/**"],
  })),
  ...(playwright.overrides ?? []).map((override) => ({
    ...override,
    files: ["e2e/**"],
  })),
];

export default defineConfig({
  env: core.env,
  extends: [core, react, tanstack],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
    // Course material kept beside the app; it is not app code.
    "assets/**",
    "lessons/**",
    "reference/**",
    ".stryker-tmp/**",
    "reports/**",
  ],
  overrides: testOverrides,
  // Vendored from github.com/dmmulroy/anti-slop; see tools/oxlint/anti-slop/UPSTREAM.md.
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    // Effect.gen and Effect.fn take anonymous generators; Effect.fn names the span.
    "func-names": "off",
    // Effect models a service, its errors and its schemas as classes in one file.
    "max-classes-per-file": "off",
    // Effect Schema pairs `const X` with `type X`; tsc rejects real redeclarations.
    "no-redeclare": "off",
    "oxc/no-accumulating-spread": "error",
    // CODING_STANDARDS.md requires each feature's public exports in index.ts.
    "oxc/no-barrel-file": "off",
    // Effect's data-first combinators (`Effect.filter(items, predicate)`) read as a thisArg.
    "unicorn/no-array-method-this-argument": "off",
    // CODING_STANDARDS.md names files camelCase and components PascalCase.
    "unicorn/filename-case": "off",
    // Its autofix puts `new` before `Schema.TaggedError<X>()(...)`, a class factory call.
    "unicorn/throw-new-error": "off",
  },
});
