import { describe, expect, it } from "vitest";

import { UxStore } from "./ux.svelte";

describe("UX confirmations", () => {
  it("supports a distinct secondary choice for three-way close prompts", async () => {
    const ux = new UxStore();
    const choice = ux.choose({
      title: "关闭未保存的文件",
      message: "main.cpp 包含未保存的更改。",
      confirmLabel: "保存并关闭",
      secondaryLabel: "不保存",
      secondaryDanger: true,
    });

    expect(ux.confirmation).toMatchObject({
      confirmLabel: "保存并关闭",
      secondaryLabel: "不保存",
      secondaryDanger: true,
    });
    ux.acceptSecondaryConfirmation();

    await expect(choice).resolves.toBe("secondary");
    expect(ux.confirmation).toBeUndefined();
    ux.dispose();
  });

  it("keeps the existing boolean confirmation API", async () => {
    const ux = new UxStore();
    const accepted = ux.confirm({ title: "确认", message: "继续吗？" });
    ux.cancelConfirmation();

    await expect(accepted).resolves.toBe(false);
    ux.dispose();
  });

  it("resolves application text prompts and cancels a previous dialog", async () => {
    const ux = new UxStore();
    const confirmation = ux.confirm({ title: "确认", message: "继续吗？" });
    const input = ux.requestText({
      title: "重命名",
      value: "main.cpp",
      confirmLabel: "保存",
    });

    await expect(confirmation).resolves.toBe(false);
    expect(ux.textPrompt).toMatchObject({ value: "main.cpp", confirmLabel: "保存" });
    ux.acceptTextPrompt("solution.cpp");

    await expect(input).resolves.toBe("solution.cpp");
    expect(ux.textPrompt).toBeUndefined();
    ux.dispose();
  });

  it("does not submit required prompts with blank text", async () => {
    const ux = new UxStore();
    const input = ux.requestText({ title: "新建文件夹" });

    ux.acceptTextPrompt("   ");
    expect(ux.textPrompt).toBeDefined();
    ux.cancelTextPrompt();

    await expect(input).resolves.toBeNull();
    ux.dispose();
  });
});
