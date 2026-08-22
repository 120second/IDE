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
});
