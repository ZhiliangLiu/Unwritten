import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startFakeOpenAiServer } from "./test-support/fake-openai-server.ts";
import { proposePreviewStep, proposeTurnStep } from "./test-support/llm-steps.ts";
import { makeTempDataDir } from "./test-support/temp-dir.ts";
import { startCore } from "./app.ts";
import type { RunningCore } from "./app.ts";
import { createLlmService } from "./llm/service.ts";
import { createLibraryService } from "./library/service.ts";
import { createAuthoringService } from "./authoring/service.ts";
import { createPlayService } from "./play/service.ts";

const workId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const endpointRequestId = "00000000-0000-4000-8000-000000000003";
const actionRequestId = "00000000-0000-4000-8000-000000000004";
const secondRequestId = "00000000-0000-4000-8000-000000000005";

function assets(dir: string): string {
  const clientDir = join(dir, "client");
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, "index.html"), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
  writeFileSync(join(clientDir, "boot.inline.js"), "");
  return clientDir;
}

const factories = {
  llm: createLlmService,
  library: createLibraryService,
  authoring: createAuthoringService,
  play: createPlayService,
};

async function boot(dataDir: string, clientDir: string): Promise<RunningCore> {
  return startCore({ dataDir, port: 0, clientDir, clientOrigin: null, logLevel: "error" }, factories);
}

describe("core integration", () => {
  it("配置模型、生成并采用开场、重启后续玩", async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, "data");
    const clientDir = assets(temp.dir);
    let core = await boot(dataDir, clientDir);
    try {
      const endpoint = await core.services.llm.createEndpoint({
        requestId: endpointRequestId as never,
        baseRevision: "absent",
        name: "测试端点",
        baseUrl: server.baseUrl,
        modelId: "test-model",
        apiKey: null,
        makeDefault: true,
      });
      expect(endpoint.config.defaultModelUsable).toBe(true);

      core.services.library.create({ workId });
      core.services.library.saveBackground({ workId, baseContentRev: 0, background: "雨夜修钟铺" });
      server.enqueue(
        proposePreviewStep({
          title: "雨夜修钟铺",
          blurb: "一个雨夜，你在钟铺里等一个人。",
          publicSetting: "老城的钟铺，雨下了一整夜。",
          prose: "雨声盖住钟声。你抬头看向门口。\n\n门铃响了。",
          options: ["去开门", "继续修钟"],
          place: "钟铺",
          time: "深夜",
          language: "zh-CN",
        }),
      );
      core.services.authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await core.services.authoring.whenIdle();
      const adopted = core.services.authoring.adoptPreview({ workId, jobId });
      const route = core.services.play.getRoute({ routeId: adopted.routeId });
      expect(route.turns).toHaveLength(1);

      server.enqueue(
        proposeTurnStep({
          prose: "你推开门。雨里没有人。",
          options: ["关上门", "走进雨里"],
          scene: { place: "门外", time: "深夜", present: [] },
        }),
      );
      core.services.play.submitAction({
        requestId: actionRequestId as never,
        routeId: adopted.routeId,
        expectedHeadTurnId: route.headTurnId,
        action: { text: "推门", optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId: adopted.routeId }).turns).toHaveLength(2);

      await core.close();
      core = await boot(dataDir, clientDir);
      const restored = core.services.play.getRoute({ routeId: adopted.routeId });
      expect(restored.turns).toHaveLength(2);
      expect(restored.turns[1]?.action?.text).toBe("推门");

      server.enqueue(
        proposeTurnStep({
          prose: "你退回钟铺，门在身后合上。",
          options: ["继续等", "去后屋"],
          scene: { place: "钟铺", time: "深夜", present: [] },
        }),
      );
      core.services.play.submitAction({
        requestId: secondRequestId as never,
        routeId: adopted.routeId,
        expectedHeadTurnId: restored.headTurnId,
        action: { text: "关上门", optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId: adopted.routeId }).turns).toHaveLength(3);
      const lastRequest = server.requests.at(-1)?.body;
      expect(JSON.stringify(lastRequest)).toContain("推门");
      expect(JSON.stringify(lastRequest)).toContain("你推开门");
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });
});
