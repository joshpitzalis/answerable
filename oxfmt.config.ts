import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    // The generated Astryx block in AGENTS.md is preformatted text.
    "AGENTS.md",
    // Vendored; reformatting it would break three-way merges with upstream.
    "tools/oxlint/anti-slop/**",
    ".stryker-tmp/**",
    "reports/**",
  ],
});
