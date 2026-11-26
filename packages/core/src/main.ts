import './llm/fetch-guard-install.ts';
import { parseCliArgs } from './cli.ts';
import { CoreStartupError, startCore } from './app.ts';
import { createLlmService } from './llm/service.ts';
import { createLibraryService } from './library/service.ts';
import { createSettingsService } from './settings/service.ts';
import { createSummaryService } from './summary/queue.ts';
import { createAuthoringService } from './authoring/service.ts';
import { createPlayService } from './play/service.ts';

async function run(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const core = await startCore(options, {
    llm: (deps) => createLlmService(deps),
    library: (deps) => createLibraryService(deps),
    settings: (deps) => createSettingsService(deps),
    summary: (deps) => createSummaryService(deps),
    authoring: (deps) => createAuthoringService(deps),
    play: (deps) => createPlayService(deps),
  });
  console.log(`UNWRITTEN_CORE_URL=${core.url}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await core.close();
    process.exit(0);
  };
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
