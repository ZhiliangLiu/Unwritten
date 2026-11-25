import { beforeEach, describe, expect, it } from "vitest";
import { applyAppearance } from "./appearance.ts";

describe("applyAppearance", () => {
  beforeEach(() => {
    Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true });
    document.documentElement.setAttribute("data-uw-appearance", "system");
    document.documentElement.removeAttribute("data-uw-theme");
    document.documentElement.removeAttribute("data-uw-theme-switching");
  });

  it("写入具体主题，不写入 system", () => {
    applyAppearance("light");
    expect(document.documentElement.getAttribute("data-uw-theme")).toBe("light");
    applyAppearance("dark");
    expect(document.documentElement.getAttribute("data-uw-theme")).toBe("dark");
  });

  it("切换到同一主题时不改变属性", () => {
    applyAppearance("light");
    applyAppearance("light");
    expect(document.documentElement.getAttribute("data-uw-theme")).toBe("light");
  });
});
