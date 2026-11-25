import { describe, expect, it } from "vitest";
import { parseProposeTurnArgs } from "./propose-turn-tool.ts";

const parentScene = { place: "钟铺", time: "深夜", present: ["学徒"] };

const valid = {
  prose: "你推开门。雨声更大了。",
  options: '{"text":"走进雨里"}\n{"text":"关上门"}',
  changes: JSON.stringify({ type: "scene", place: "门外", time: "深夜", present: "学徒,掌柜" }),
  ending: "false",
};

describe("parseProposeTurnArgs", () => {
  it("接受合格参数并更新场景", () => {
    const result = parseProposeTurnArgs(valid, parentScene);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scene).toEqual({ place: "门外", time: "深夜", present: ["学徒", "掌柜"] });
      expect(result.value.options).toHaveLength(2);
    }
  });

  it("changes 为空时沿用父场景", () => {
    const result = parseProposeTurnArgs({ ...valid, changes: "" }, parentScene);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scene).toEqual(parentScene);
  });

  it("拒绝结束、未知类型和越界内容", () => {
    expect(parseProposeTurnArgs({ ...valid, ending: "true" }, parentScene).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, changes: '{"type":"event"}' }, parentScene).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, prose: "" }, parentScene).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, options: "" }, parentScene).ok).toBe(false);
  });
});
