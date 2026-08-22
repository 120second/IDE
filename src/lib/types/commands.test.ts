import { describe, expect, it, vi } from "vitest";

import { rankWorkbenchCommands, type WorkbenchCommand } from "./commands";

const commands: WorkbenchCommand[] = [
  { id: "file.quickOpen", label: "快速打开文件", category: "文件", run: vi.fn() },
  { id: "file.save", label: "保存当前文件", category: "文件", run: vi.fn() },
  { id: "view.settings", label: "打开设置", category: "视图", run: vi.fn() },
];

describe("command palette ranking", () => {
  it("keeps the declared order for an empty query", () => {
    expect(rankWorkbenchCommands(commands, "")).toEqual(commands);
  });

  it("prefers a label match over category and id matches", () => {
    expect(rankWorkbenchCommands(commands, "保存").map((item) => item.id)).toEqual(["file.save"]);
    expect(rankWorkbenchCommands(commands, "settings")[0]?.id).toBe("view.settings");
  });

  it("supports subsequence lookup for discoverability", () => {
    expect(rankWorkbenchCommands(commands, "fqop")[0]?.id).toBe("file.quickOpen");
  });
});
