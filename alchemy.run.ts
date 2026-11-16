import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const Website = Cloudflare.Website.Vite("Website", {
  env: {
    AI: Cloudflare.Workers.AI(),
    // Empty when unset: the question-finder runtime then serves fixture data.
    DISCORD_BOT_TOKEN: Config.Redacted("DISCORD_BOT_TOKEN").pipe(
      Config.withDefault(Redacted.make(""))
    ),
  },
  // `DEV_PORT` lets e2e (playwright.config.ts, `E2E_PORT`) run beside a dev server.
  dev: { port: Number(process.env.DEV_PORT ?? 1337), strictPort: true },
  observability: { enabled: true },
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
  "Answerable",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website;

    return { url: website.url.as<string>() };
  })
);
