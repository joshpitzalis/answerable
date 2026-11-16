import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Agent worktrees are created under .claude/; each one reloaded a running dev server.
  server: { watch: { ignored: ["**/.claude/**"] } },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});

export default config;
