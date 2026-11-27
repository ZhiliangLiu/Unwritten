export const SHELL_ENV_TIMEOUT_MS = 5_000;

export interface ShellEnvResult {
  env: NodeJS.ProcessEnv;
  ok: boolean;
  timedOut: boolean;
  vars: number;
}

export async function resolveShellEnv(input: {
  platform: NodeJS.Platform;
  base: NodeJS.ProcessEnv;
  read: () => Promise<Record<string, string>>;
  timeoutMs?: number;
}): Promise<ShellEnvResult> {
  if (input.platform === 'win32') {
    return { env: { ...input.base }, ok: true, timedOut: false, vars: 0 };
  }

  const timeoutMs = input.timeoutMs ?? SHELL_ENV_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const read = input.read();
    const result = await Promise.race([
      read.then((env) => ({ timedOut: false as const, env })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);

    if (result.timedOut) return { env: { ...input.base }, ok: false, timedOut: true, vars: 0 };
    return {
      env: { ...input.base, ...result.env },
      ok: true,
      timedOut: false,
      vars: Object.keys(result.env).length,
    };
  } catch {
    return { env: { ...input.base }, ok: false, timedOut: false, vars: 0 };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
