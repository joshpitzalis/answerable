/* oxlint-disable anti-slop/no-unknown-parameters -- the probe describes JSON of any kind; that is its job */
export type JsonOutline =
  | string
  | { readonly length: number; readonly first?: JsonOutline }
  | { readonly [key: string]: JsonOutline };

export const describeJson: (value: unknown) => JsonOutline;
export const tokenFromEnv: (envText: string) => string | null;

export const probe: (
  args: readonly string[],
  envText: string | null,
  fetchFn: typeof globalThis.fetch
) => Promise<{ readonly exitCode: number; readonly lines: string[] }>;
