import { describe, expect, it } from "vitest";

import { TemplateStore } from "./templates.svelte";

describe("template store", () => {
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
