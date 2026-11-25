import "./llm/fetch-guard-install.ts";
import { parseCliArgs } from "./cli.ts";
import { startCore } from "./app.ts";
import { createLlmService } from "./llm/service.ts";
import { createLibraryService } from "./library/service.ts";
import { createAuthoringService } from "./authoring/service.ts";
import { createPlayService } from "./play/service.ts";

async function run(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const core = await startCore(options, {
    llm: (deps) => createLlmService(deps),
    library: (deps) => createLibraryService(deps),
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
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void run().catch(() => {
  process.stderr.write("unwritten: core failed to start\n");
  process.exit(1);
});
