import { describe, expect, it } from "vitest";
import { parsePreviewArgs } from "./preview-tool.ts";

const valid = {
  title: "雨夜修钟铺",
  blurb: "一个雨夜，你在钟铺里等一个人。",
  public_setting: "老城的钟铺，雨下了一整夜。",
  prose: "雨声盖住钟声。你抬头看向门口。\n\n门铃响了。",
  options: '{"text":"去开门"}\n{"text":"继续修钟"}',
  place: "钟铺",
  time: "深夜",
  language: "zh-CN",
};

describe("parsePreviewArgs", () => {
  it("接受合格参数", () => {
    const result = parsePreviewArgs(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.publicSetting).toBe(valid.public_setting);
      expect(result.value.options).toHaveLength(2);
      expect(result.value.scene).toEqual({ place: "钟铺", time: "深夜" });
    }
  });

  it("每条规则都有错误说明", () => {
    expect(parsePreviewArgs({ ...valid, title: "" }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, prose: "" }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, options: "" }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, options: '{"text":"一","hint":"x"}' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, language: "不合法" }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, title: 1 }).ok).toBe(false);
  });
});
