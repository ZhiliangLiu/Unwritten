import type { KeyStatus } from "@unwritten/contracts";

const ENV_REFERENCE = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

export function envVarOf(raw: string): string | null {
  const match = ENV_REFERENCE.exec(raw);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

export function resolveApiKey(raw: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (!raw) return undefined;
  const name = envVarOf(raw);
  if (name === null) return raw;
  return env[name] || undefined;
}

export function keyStatus(raw: string | undefined, env: NodeJS.ProcessEnv): KeyStatus {
  if (!raw) return { hasKey: false, source: "none", envVar: null };
  const name = envVarOf(raw);
  if (name !== null) return { hasKey: Boolean(env[name]), source: "env", envVar: name };
  return { hasKey: true, source: "file", envVar: null };
}
