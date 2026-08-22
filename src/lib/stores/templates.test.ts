import { describe, expect, it } from "vitest";

import { TemplateStore } from "./templates.svelte";

describe("template creation drafts", () => {
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
});
