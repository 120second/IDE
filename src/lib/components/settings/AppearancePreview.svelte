<script lang="ts">
  import { onMount } from "svelte";
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import { cpp } from "@codemirror/lang-cpp";
  import { createAppearanceExtension } from "../../editor/appearance";
  import type { AppSettings } from "../../types/settings";
  import Icon from "../shell/Icon.svelte";

  let { settings }: { settings: AppSettings } = $props();
  let host: HTMLDivElement;
  let view = $state.raw<EditorView>();
  let menuOpen = $state(false);
  const appearance = new Compartment();
  const sample = '// C++ 配色预览\n#include <iostream>\n\nint main() {\n    int n = 42;\n    std::cout << "Hello" << n;\n    return 0;\n}';

  onMount(() => {
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: sample,
        extensions: [cpp(), lineNumbers(), highlightActiveLine(), EditorView.lineWrapping, EditorState.readOnly.of(true),
          EditorView.editable.of(false), EditorView.contentAttributes.of({ "aria-label": "C++ 外观预览" }),
          appearance.of(createAppearanceExtension(settings)),
          EditorView.theme({ "&": { height: "230px" }, ".cm-scroller": { overflow: "auto" } }),
        ],
      }),
    });
    view = editor;
    return () => { view = undefined; editor.destroy(); };
  });

  $effect(() => {
    const current = settings;
    view?.dispatch({ effects: appearance.reconfigure(createAppearanceExtension(current)) });
  });
</script>

<aside class="appearance-preview" aria-label="外观实时预览">
  <div class="appearance-preview-heading"><strong>实时预览</strong><span>与工作台同步</span></div>
  <div class="appearance-preview-stage">
    <div class="preview-workbench">
      <div class="preview-sidebar"><strong>文件</strong><span>⌄ 练习</span><span class="selected"><Icon name="cpp" size={13} />main.cpp</span><span><Icon name="file" size={13} />input.txt</span></div>
      <div class="preview-main">
        <div class="preview-tabs"><span>main.cpp</span><button type="button" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>预览菜单</button></div>
        <div class="preview-editor" bind:this={host}></div>
        <div class="preview-output"><strong>输出</strong><span class="preview-success">✓ 编译成功</span><code>Hello42</code><span class="preview-error">错误提示示例</span></div>
      </div>
      {#if menuOpen}<div class="preview-popup"><strong>弹窗与控件</strong><input aria-label="输入框外观预览" readonly value="solution.cpp" /><button type="button" class="primary-button" onclick={() => (menuOpen = false)}>完成预览</button></div>{/if}
    </div>
  </div>
  <p>调整立即生效并自动保存。面板透明度只改变底色，文字保持清晰。</p>
</aside>
