import { describe, expect, it } from "vitest";
import type { TurnRow } from "./chain.ts";
import { buildNarratorContext } from "./context.ts";

function turn(depth: number, prose: string): TurnRow {
  return {
    id: `t${depth}`,
    playthroughId: "p",
    parentId: depth === 0 ? null : `t${depth - 1}`,
    depth,
    action: depth === 0 ? null : { text: `行动${depth}`, optionIndex: null },
    prose,
    options: [],
    scene: { place: "钟铺", time: "深夜", present: [] },
    ending: 0,
    status: "committed",
    createdAt: depth,
  };
}

const meta = {
  background: "雨夜修钟铺",
  plan: { items: [{ id: "public_setting", text: "老城的钟铺", source: "ai" as const }] },
  narration: { language: "zh-CN" },
};

const model = { endpointId: "e", modelId: "m", contextWindow: 1_000, maxOutputTokens: 100 };
const estimate = (text: string) => text.length;

describe("buildNarratorContext", () => {
  it("预算充足时带上全部回合", () => {
    const result = buildNarratorContext({
      meta,
      chain: [turn(0, "开场正文"), turn(1, "第一段回应")],
      action: { text: "推门", optionIndex: null },
      model,
      estimateTokens: estimate,
      toolSchemaText: "schema",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("开场正文");
      expect(result.prompt).toContain("第一段回应");
      expect(result.prompt).toContain("玩家行动：行动1");
      expect(result.omittedTurns).toBe(0);
    }
  });

  it("预算连必需材料都不够时返回 context_too_small", () => {
    const result = buildNarratorContext({
      meta,
      chain: [turn(0, "很长的开场".repeat(100)), turn(1, "回应")],
      action: { text: "推门", optionIndex: null },
      model: { ...model, contextWindow: 200 },
      estimateTokens: estimate,
      toolSchemaText: "schema",
    });
    expect(result).toEqual({ ok: false, code: "context_too_small" });
  });
});
