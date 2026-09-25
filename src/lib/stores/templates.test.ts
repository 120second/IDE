import { describe, expect, it } from "vitest";

import { TemplateStore } from "./templates.svelte";

describe("template store", () => {
  it("uses local storage by default and can switch storage explicitly", async () => {
    const store = new TemplateStore({ setTemplateCompletionProvider: () => {} } as never, {} as never);

    expect(store.storage).toBe("local");
    expect(store.supportsHistory).toBe(true);

    await store.setStorage("cloud");
    expect(store.storage).toBe("cloud");
    expect(store.supportsHistory).toBe(false);
  });

  it("shows only file templates and their ancestor categories in the file tree", () => {
    const store = new TemplateStore({ setTemplateCompletionProvider: () => {} } as never, {} as never);
    store.kind = "file";
    const category = (id: number, name: string, parentId?: number) => ({
      id, name, parentId, sortOrder: 0, createdAt: "", updatedAt: "",
    });
    store.categories = [category(1, "图论"), category(2, "文件"), category(3, "竞赛", 2), category(4, "片段", 2)];
    const base = { trigger: "", aliases: [], description: "", language: "cpp", favorite: false, sortOrder: 0, useCount: 0, createdAt: "", updatedAt: "" };
    store.treeTemplates = [
      { ...base, id: 1, name: "Dijkstra", kind: "snippet", categoryId: 1 },
      { ...base, id: 2, name: "Contest C++", kind: "file", categoryId: 3 },
      { ...base, id: 3, name: "Empty C++", kind: "file" },
      { ...base, id: 4, name: "片段", kind: "snippet", categoryId: 4 },
    ];
    store.toggleCategory(2);
    store.toggleCategory(3);
    expect(store.treeRows.map((row) => row.kind === "category" ? row.category.name : row.template.name))
      .toEqual(["文件", "竞赛", "Contest C++", "Empty C++"]);
  });

  it("hides all snippet categories when file templates are uncategorized", () => {
    const store = new TemplateStore({ setTemplateCompletionProvider: () => {} } as never, {} as never);
    store.kind = "file";
    store.categories = [{ id: 1, name: "图论", sortOrder: 0, createdAt: "", updatedAt: "" }];
    expect(store.treeRows).toEqual([]);
  });

  it("keeps a new snippet draft when the editor is collapsed", () => {
    const store = new TemplateStore({ setTemplateCompletionProvider: () => {} } as never, {} as never);
    store.beginCreate("snippet");
    store.draft.name = "Dinic";
    store.draft.trigger = "dinic";
    store.draft.aliases = ["最大流", "maxflow"];
    store.draft.code = "struct Dinic {};";

    store.collapseEditor();
    expect(store.mode).toBe("empty");
    expect(store.selectedId).toBeUndefined();

    store.beginCreate("snippet");
    expect(store.mode).toBe("create");
    expect(store.draft).toMatchObject({
      name: "Dinic",
      trigger: "dinic",
      aliases: ["最大流", "maxflow"],
      code: "struct Dinic {};",
    });
  });

  it("exposes concrete templates as leaf nodes below expanded folders", () => {
    const store = new TemplateStore({ setTemplateCompletionProvider: () => {} } as never, {} as never);
    store.categories = [{
      id: 1,
      name: "组合数学",
      sortOrder: 0,
      createdAt: "",
      updatedAt: "",
    }];
    store.treeTemplates = [{
      id: 8,
      kind: "snippet",
      name: "快速数论变换",
      trigger: "NTT",
      aliases: [],
      description: "",
      language: "cpp",
      categoryId: 1,
      favorite: false,
      sortOrder: 0,
      useCount: 0,
      createdAt: "",
      updatedAt: "",
    }];

    expect(store.treeRows).toHaveLength(1);
    expect(store.treeRows[0]).toMatchObject({ kind: "category", hasChildren: true });

    store.toggleCategory(1);
    expect(store.treeRows).toHaveLength(2);
    expect(store.treeRows[1]).toMatchObject({
      kind: "template",
      depth: 1,
      template: { name: "快速数论变换" },
    });
  });
});
