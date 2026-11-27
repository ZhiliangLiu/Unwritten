import './llm/fetch-guard-install.ts';
import type { ParentPortLike } from './desktop/channel.ts';
import { attachDesktopChannel, desktopParentPort, waitForStart } from './desktop/channel.ts';
import { parseCliArgs } from './cli.ts';
import { CoreStartupError, startCore } from './app.ts';
import type { RunningCore } from './app.ts';
import type { ServiceFactories } from './services.ts';
import { createLlmService } from './llm/service.ts';
import { createLibraryService } from './library/service.ts';
import { createSettingsService } from './settings/service.ts';
import { createSummaryService } from './summary/queue.ts';
import { createAuthoringService } from './authoring/service.ts';
import { createPlayService } from './play/service.ts';

const START_FAILED_EXIT_DELAY_MS = 2_000;

const factories: ServiceFactories = {
  llm: (deps) => createLlmService(deps),
  library: (deps) => createLibraryService(deps),
  settings: (deps) => createSettingsService(deps),
  summary: (deps) => createSummaryService(deps),
  authoring: (deps) => createAuthoringService(deps),
  play: (deps) => createPlayService(deps),
};

function shutdownFor(core: RunningCore): () => Promise<void> {
  let closing = false;
  return async () => {
    if (closing) return;
    closing = true;
    await core.close();
    process.exit(0);
  };
}

async function runInDesktop(port: ParentPortLike): Promise<void> {
  const { start, invalid } = await waitForStart(port);
  let core: RunningCore;
  try {
    core = await startCore(
      {
        dataDir: start.dataDir,
        port: start.port,
        clientDir: start.clientDir,
        clientOrigin: start.clientOrigin,
        logLevel: start.logLevel,
        token: start.token,
        dev: start.dev,
      },
      factories,
    );
  } catch (error) {
    if (!(error instanceof CoreStartupError)) throw error;
    port.postMessage({ type: 'start-failed', reason: error.reason, diagnosticId: error.diagnosticId });
    setTimeout(() => process.exit(1), START_FAILED_EXIT_DELAY_MS);
    return;
  }
  const shutdown = shutdownFor(core);
  attachDesktopChannel({ port, core, invalidBeforeStart: invalid, onStop: () => void shutdown() });
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function run(): Promise<void> {
  const port = desktopParentPort();
  if (port) return runInDesktop(port);
  const options = parseCliArgs(process.argv.slice(2));
  const core = await startCore(options, factories);
  console.log(`UNWRITTEN_CORE_URL=${core.url}`);
  const shutdown = shutdownFor(core);
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const startupMessages = {
  data_locked: 'The data directory is already in use. Close the other instance and try again.',
  port_in_use: 'The requested port is already in use. Choose another port and try again.',
  data_dir: 'The data directory is unavailable. Check its location and permissions.',
  startup: 'Core could not start. Check diagnostics.db in the data directory.',
};

void run().catch((error: unknown) => {
  if (error instanceof CoreStartupError) {
    process.stderr.write(`unwritten: ${startupMessages[error.reason]} (${error.diagnosticId})\n`);
  } else {
    process.stderr.write(
      'unwritten: invalid startup arguments. Check --data-dir, --port, --client-dir, --client-origin and --log-level.\n',
    );
  }
  process.exit(1);
});
