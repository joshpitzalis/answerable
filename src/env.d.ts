import type { WebsiteEnv } from "../alchemy.run.ts";

// Types `import { env } from "cloudflare:workers"` from the bindings declared in alchemy.run.ts.
declare module "cloudflare:workers" {
  namespace Cloudflare {
    // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- declaration merging needs an interface
    interface Env extends WebsiteEnv {}
  }
}
