import type { CoreToDesktop, StartMessage } from '@unwritten/contracts/desktop';
import { DesktopToCoreSchema } from '@unwritten/contracts/desktop';
import type { RunningCore } from '../app.ts';
import { parseOrigin } from '../cli.ts';

export interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: CoreToDesktop): void;
}

export function desktopParentPort(): ParentPortLike | null {
  const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  return port ?? null;
}

export async function waitForStart(port: ParentPortLike): Promise<{ start: StartMessage; invalid: number }> {
  return await new Promise((resolve) => {
    let settled = false;
    let invalid = 0;
    port.on('message', (event) => {
      if (settled) return;
      const result = DesktopToCoreSchema.safeParse(event.data);
      if (!result.success || result.data.type !== 'start') {
        invalid += 1;
        return;
      }
      if (result.data.clientOrigin !== null) {
        try {
          parseOrigin(result.data.clientOrigin);
        } catch {
          invalid += 1;
          return;
        }
      }
      settled = true;
      resolve({ start: result.data, invalid });
    });
  });
}

export function attachDesktopChannel(input: {
  port: ParentPortLike;
  core: RunningCore;
  invalidBeforeStart: number;
  onStop: () => void;
}): () => void {
  const { port, core } = input;
  if (input.invalidBeforeStart > 0) {
    core.services.logger.record({
      level: 'warn',
      module: 'core',
      event: 'desktop.channel.invalid',
      data: { kind: 'start', issues: input.invalidBeforeStart },
    });
  }
  port.postMessage({ type: 'ready', port: core.port, appearance: core.services.settings.get() });

  const controller = new AbortController();
  void (async () => {
    for await (const event of core.services.bus.subscribe(controller.signal)) {
      if (event.type === 'settings.changed') {
        port.postMessage({ type: 'appearance-changed', appearance: event.appearance });
      }
    }
  })();

  let stopped = false;
  let detached = false;
  port.on('message', (event) => {
    if (detached) return;
    const result = DesktopToCoreSchema.safeParse(event.data);
    if (!result.success) {
      core.services.logger.record({
        level: 'warn',
        module: 'core',
        event: 'desktop.channel.invalid',
        data: { kind: 'log', issues: result.error.issues.length },
      });
      return;
    }
    const message = result.data;
    if (message.type === 'start') return;
    if (message.type === 'log') {
      if (message.entry.kind === 'event') {
        core.services.logger.record({
          level: message.entry.level,
          module: 'desktop',
          event: message.entry.event,
          data: message.entry.data,
        });
      } else {
        core.services.logger.sample({
          source: 'desktop',
          metric: message.entry.metric,
          durationMs: message.entry.durationMs,
          outcome: message.entry.outcome,
          attempt: message.entry.attempt,
        });
      }
      return;
    }
    if (!stopped) {
      stopped = true;
      input.onStop();
    }
  });

  return () => {
    detached = true;
    controller.abort();
  };
}
