<script lang="ts">
  import DOMPurify from "dompurify";
  import { Marked } from "marked";
  import markedKatex from "marked-katex-extension";
  import "katex/dist/katex.min.css";
  import { onDestroy, untrack } from "svelte";
  import {
    deleteProblemPdf,
    loadProblemDocument,
    loadProblemPdf,
    problemDocumentKey,
    saveProblemDocument,
    saveProblemPdf,
    titleFromMarkdown,
    type ProblemDocumentMeta,
  } from "../../problemReader";
  import type { UxStore } from "../../stores/ux.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    sourcePath?: string;
    sourceTitle?: string;
    width: number;
    dock: "left" | "right";
    setWidth: (width: number) => void;
    toggleDock: () => void;
    close: () => void;
    importSample: (sample: { name: string; input: string; expectedOutput: string }) => Promise<boolean>;
    ux: UxStore;
  }

  let { sourcePath, sourceTitle, width, dock, setWidth, toggleDock, close, importSample, ux }: Props = $props();
  let fileInput: HTMLInputElement;
  let activeKey = "";
  let loadSequence = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pdfUrl = $state("");
  let loading = $state(false);
  let draggingFile = $state(false);
  let view = $state<"read" | "edit" | "pdf">("read");
  let document = $state<ProblemDocumentMeta>(emptyDocument());
  let documentKey = $derived(problemDocumentKey(sourcePath));
  let renderedMarkdown = $derived(renderMarkdown(document.markdown));
  let sourceLabel = $derived(sourceTitle ? sourceTitle.replace(/\.[^.]+$/, "") : "未关联代码文件");
  let stopResize = () => {};

  const markdownParser = new Marked({ gfm: true, breaks: true });
  markdownParser.use(markedKatex({ throwOnError: false, nonStandard: true }));

  $effect(() => {
    const nextKey = documentKey;
    if (nextKey === activeKey) return;
    untrack(() => void loadDocument(nextKey));
  });

  onDestroy(() => {
    flushSave();
    revokePdfUrl();
    stopResize();
  });

  async function loadDocument(key: string): Promise<void> {
    flushSave();
    const sequence = ++loadSequence;
    activeKey = key;
    revokePdfUrl();
    loading = true;
    const stored = loadProblemDocument(key) ?? emptyDocument();
    document = stored;
    view = stored.kind === "pdf" ? "pdf" : stored.markdown ? "read" : "edit";
    try {
      if (stored.kind === "pdf" || stored.pdfName) {
        const blob = await loadProblemPdf(key);
        if (sequence !== loadSequence) return;
        if (blob) pdfUrl = URL.createObjectURL(blob);
        else if (stored.kind === "pdf" && stored.markdown) {
          document.kind = "markdown";
          document.title = titleFromMarkdown(document.markdown, sourceLabel || "题面");
          view = "read";
          saveProblemDocument(key, document);
        } else if (stored.kind === "pdf") {
          document = emptyDocument();
          saveProblemDocument(key, document);
          view = "edit";
        }
      }
    } catch (error) {
      if (sequence === loadSequence) ux.error(`无法读取本地 PDF：${errorMessage(error)}`);
    } finally {
      if (sequence === loadSequence) loading = false;
    }
  }

  function emptyDocument(): ProblemDocumentMeta {
    return { kind: "markdown", title: "题面", markdown: "", updatedAt: Date.now() };
  }

  function scheduleSave(): void {
    document.kind = "markdown";
    document.title = titleFromMarkdown(document.markdown, sourceLabel || "题面");
    document.updatedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      if (activeKey) saveProblemDocument(activeKey, document);
    }, 180);
  }

  function flushSave(): void {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (activeKey) saveProblemDocument(activeKey, document);
  }

  async function newMarkdown(): Promise<void> {
    if (hasContent() && !await ux.confirm({
      title: "新建题面",
      message: "当前代码文件已经关联了题面。新建后将替换现有内容。",
      confirmLabel: "新建题面",
      danger: false,
    })) return;
    revokePdfUrl();
    try {
      await deleteProblemPdf(documentKey);
    } catch {
      // No stored PDF is a valid state.
    }
    document = emptyDocument();
    document.title = sourceLabel || "题面";
    saveProblemDocument(documentKey, document);
    view = "edit";
  }

  function hasContent(): boolean {
    return Boolean(pdfUrl || document.pdfName || document.markdown.trim());
  }

  function chooseFile(): void {
    fileInput.click();
  }

  async function handleFileInput(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await importFile(file);
  }

  async function importFile(file: File): Promise<void> {
    if (isPdf(file)) {
      await importPdf(file);
      return;
    }
    if (!isMarkdown(file)) {
      ux.error("请选择 Markdown、文本或 PDF 文件。");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      ux.error("Markdown 文件不能超过 4 MiB。");
      return;
    }
    try {
      const markdown = await file.text();
      await useMarkdown(markdown, file.name.replace(/\.(md|markdown|txt)$/i, ""));
      ux.success("题面已导入并自动排版。");
    } catch (error) {
      ux.error(`无法读取题面文件：${errorMessage(error)}`);
    }
  }

  async function useMarkdown(markdown: string, fallbackTitle = sourceLabel): Promise<void> {
    document = {
      ...document,
      kind: "markdown",
      title: titleFromMarkdown(markdown, fallbackTitle || "题面"),
      markdown,
      updatedAt: Date.now(),
    };
    saveProblemDocument(documentKey, document);
    view = "read";
  }

  async function importPdf(file: File): Promise<void> {
    if (file.size > 80 * 1024 * 1024) {
      ux.error("PDF 文件不能超过 80 MiB。");
      return;
    }
    loading = true;
    try {
      const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
      await saveProblemPdf(documentKey, blob);
      revokePdfUrl();
      pdfUrl = URL.createObjectURL(blob);
      document = {
        ...document,
        kind: "pdf",
        title: file.name.replace(/\.pdf$/i, "") || sourceLabel || "PDF 题面",
        pdfName: file.name,
        updatedAt: Date.now(),
      };
      saveProblemDocument(documentKey, document);
      view = "pdf";
      ux.success("PDF 已保存到本机并关联当前代码文件。");
    } catch (error) {
      ux.error(`无法导入 PDF：${errorMessage(error)}`);
    } finally {
      loading = false;
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])];
    const file = files.find((candidate) => isPdf(candidate) || isMarkdown(candidate));
    if (file) {
      event.preventDefault();
      void importFile(file);
      return;
    }
    if (event.target instanceof HTMLTextAreaElement) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text?.trim()) return;
    event.preventDefault();
    void useMarkdown(text);
    ux.success("Markdown 已粘贴并自动排版。");
  }

  function handleDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    draggingFile = true;
  }

  function handleDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
      draggingFile = false;
    }
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    draggingFile = false;
    const file = event.dataTransfer?.files[0];
    if (file) void importFile(file);
  }

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    stopResize();
    const startX = event.clientX;
    const startWidth = width;
    const direction = dock === "right" ? 1 : -1;
    const onMove = (moveEvent: PointerEvent) => setWidth(startWidth + direction * (startX - moveEvent.clientX));
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      stopResize = () => {};
    };
    const onUp = () => cleanup();
    stopResize = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grow = dock === "right" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
    setWidth(width + (grow ? 20 : -20));
  }

  function selectMarkdownView(next: "read" | "edit"): void {
    view = next === "read" && !document.markdown.trim() ? "edit" : next;
    document.kind = "markdown";
    document.title = titleFromMarkdown(document.markdown, sourceLabel || "题面");
    document.updatedAt = Date.now();
    if (activeKey) saveProblemDocument(activeKey, document);
  }

  function selectPdfView(): void {
    if (!pdfUrl) return;
    view = "pdf";
    document.kind = "pdf";
    document.title = document.pdfName?.replace(/\.pdf$/i, "") || document.title || "PDF 题面";
    document.updatedAt = Date.now();
    if (activeKey) saveProblemDocument(activeKey, document);
  }

  async function handleRenderedClick(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-reader-action]");
    if (!button) return;
    const block = button.closest<HTMLElement>(".reader-code-block");
    const content = block?.querySelector("code")?.textContent ?? "";
    if (!content) return;

    if (button.dataset.readerAction === "copy") {
      try {
        await navigator.clipboard.writeText(content);
        ux.success("样例内容已复制。");
      } catch (error) {
        ux.error(`无法复制样例：${errorMessage(error)}`);
      }
      return;
    }

    if (button.dataset.readerAction !== "import" || !block) return;
    const sampleId = block.dataset.sampleId ?? "1";
    const article = event.currentTarget as HTMLElement;
    const output = article.querySelector<HTMLElement>(`.reader-code-block[data-sample-kind="output"][data-sample-id="${sampleId}"] code`)?.textContent ?? "";
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "导入中…";
    const imported = await importSample({
      name: `样例 ${sampleId}`,
      input: content,
      expectedOutput: output,
    });
    button.textContent = imported ? "已导入" : originalLabel;
    button.disabled = imported;
  }

  function openPdfWindow(): void {
    if (pdfUrl) window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }

  function revokePdfUrl(): void {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = "";
  }

  function isPdf(file: File): boolean {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  }

  function isMarkdown(file: File): boolean {
    return file.type.startsWith("text/") || /\.(md|markdown|txt)$/i.test(file.name);
  }

  function renderMarkdown(source: string): string {
    if (!source.trim()) return "";
    const html = markdownParser.parse(source) as string;
    const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } });
    return decorateCodeBlocks(sanitized);
  }

  function decorateCodeBlocks(html: string): string {
    const template = window.document.createElement("template");
    template.innerHTML = html;
    let inputIndex = 0;
    let outputIndex = 0;

    for (const pre of [...template.content.querySelectorAll("pre")]) {
      const context = sampleContext(pre);
      const kind = context?.kind;
      const sampleId = context?.id
        ?? String(kind === "input" ? ++inputIndex : kind === "output" ? ++outputIndex : "");
      if (context?.id) {
        if (kind === "input") inputIndex = Math.max(inputIndex, Number(context.id));
        if (kind === "output") outputIndex = Math.max(outputIndex, Number(context.id));
      }

      const wrapper = window.document.createElement("div");
      wrapper.className = "reader-code-block";
      if (kind && sampleId) {
        wrapper.dataset.sampleKind = kind;
        wrapper.dataset.sampleId = sampleId;
      }
      const actions = window.document.createElement("div");
      actions.className = "reader-code-actions";
      actions.append(codeAction("copy", "复制"));
      if (kind === "input") actions.append(codeAction("import", "导入测试"));
      pre.replaceWith(wrapper);
      wrapper.append(actions, pre);
    }
    return template.innerHTML;
  }

  function sampleContext(pre: Element): { kind: "input" | "output"; id?: string } | undefined {
    let previous = pre.previousElementSibling;
    while (previous && !previous.matches("pre, .reader-code-block")) {
      if (previous.matches("h1, h2, h3, h4, h5, h6, strong")) {
        const label = previous.textContent?.trim() ?? "";
        const input = label.match(/(?:输入|sample\s+input|input\s+sample|\binput\b)\D*(\d+)?/i);
        if (input) return { kind: "input", id: input[1] };
        const output = label.match(/(?:输出|sample\s+output|output\s+sample|\boutput\b)\D*(\d+)?/i);
        if (output) return { kind: "output", id: output[1] };
      }
      previous = previous.previousElementSibling;
    }
    return undefined;
  }

  function codeAction(action: "copy" | "import", label: string): HTMLButtonElement {
    const button = window.document.createElement("button");
    button.type = "button";
    button.dataset.readerAction = action;
    button.textContent = label;
    button.setAttribute("aria-label", action === "copy" ? "复制代码块内容" : "将输入输出样例导入测试点");
    return button;
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<aside
  class:dragging-file={draggingFile}
  class:dock-left={dock === "left"}
  class="problem-reader"
  style:width={`${width}px`}
  aria-label="读题面板"
  onpaste={handlePaste}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="problem-reader-resize"
    role="separator"
    aria-label="调整读题面板宽度"
    aria-orientation="vertical"
    aria-valuemin="300"
    aria-valuemax="760"
    aria-valuenow={width}
    tabindex="0"
    onpointerdown={beginResize}
    onkeydown={resizeWithKeyboard}
  ></div>

  <div class="problem-reader-toolbar">
    <div class="problem-reader-actions">
      <button onclick={() => void newMarkdown()}><Icon name="plus" size={13} /><span>新建</span></button>
      <button onclick={chooseFile}><Icon name="folder-open" size={13} /><span>导入</span></button>
      {#if view === "pdf" && pdfUrl}
        <button onclick={openPdfWindow} title="在独立窗口打开 PDF"><Icon name="zen" size={13} /><span>弹出</span></button>
      {/if}
    </div>
    <div class="reader-toolbar-end">
      <div class="reader-view-switch" role="tablist" aria-label="题面视图">
        <button class:active={view === "read"} role="tab" aria-selected={view === "read"} onclick={() => selectMarkdownView("read")}>阅读</button>
        <button class:active={view === "edit"} role="tab" aria-selected={view === "edit"} onclick={() => selectMarkdownView("edit")}>Markdown</button>
        <button class:active={view === "pdf"} role="tab" aria-selected={view === "pdf"} disabled={!pdfUrl} title={pdfUrl ? "查看已导入的 PDF" : "导入 PDF 后可用"} onclick={selectPdfView}>PDF</button>
      </div>
      <div class="problem-reader-header-actions">
        <button aria-label={dock === "right" ? "将读题面板移到左侧" : "将读题面板移到右侧"} title={dock === "right" ? "移到左侧" : "移到右侧"} onclick={toggleDock}><Icon name="repeat" size={14} /></button>
        <button aria-label="关闭读题面板" title="关闭读题面板" onclick={close}><Icon name="close" size={15} /></button>
      </div>
    </div>
  </div>

  <input bind:this={fileInput} class="reader-file-input" type="file" accept=".md,.markdown,.txt,.pdf,text/plain,text/markdown,application/pdf" onchange={(event) => void handleFileInput(event)} />

  <div class="problem-reader-body">
    {#if loading}
      <div class="reader-loading" aria-live="polite"><span></span><p>正在载入题面…</p></div>
    {:else if view === "pdf"}
      {#if pdfUrl}
        <iframe class="reader-pdf" src={pdfUrl} title={document.pdfName ?? document.title}></iframe>
      {:else}
        <div class="reader-empty"><Icon name="warning" size={24} /><strong>PDF 无法读取</strong><p>重新导入原 PDF 文件即可恢复。</p><button onclick={chooseFile}>重新导入</button></div>
      {/if}
    {:else if view === "edit"}
      <div class="reader-editor">
        <textarea
          bind:value={document.markdown}
          aria-label="题面 Markdown"
          spellcheck="false"
          placeholder={'# 题目名称\n\n粘贴 Markdown 题面，支持标题、列表、表格、代码块和图片。'}
          oninput={scheduleSave}
          onkeydown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              flushSave();
              selectMarkdownView("read");
            }
          }}
        ></textarea>
        <footer><span>自动保存在本机</span><button class="primary-button" onclick={() => { flushSave(); selectMarkdownView("read"); }}>排版阅读</button></footer>
      </div>
    {:else if renderedMarkdown}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <article class="reader-markdown" onclick={(event) => void handleRenderedClick(event)}>{@html renderedMarkdown}</article>
    {:else}
      <div class="reader-empty reader-empty-drop">
        <span class="reader-empty-icon"><Icon name="book" size={26} /></span>
        <strong>把题面放在代码旁边</strong>
        <p>直接在这里粘贴 Markdown，或拖入 Markdown / PDF 文件。题面会与当前代码文件关联并保存在本机。</p>
        <div><button class="primary-button" onclick={() => selectMarkdownView("edit")}>粘贴 Markdown</button><button class="secondary-button" onclick={chooseFile}>选择文件</button></div>
        <small>提示：在面板空白处按 Ctrl+V 会直接排版。</small>
      </div>
    {/if}
  </div>

  {#if draggingFile}<div class="reader-drop-overlay"><Icon name="download" size={28} /><strong>松开以导入题面</strong><span>支持 Markdown、TXT 和 PDF</span></div>{/if}
</aside>

<style>
  .problem-reader {
    position: relative;
    display: flex;
    min-width: 300px;
    max-width: 760px;
    min-height: 0;
    flex: 0 0 auto;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border-strong);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--panel-background) 97%, var(--editor-background));
  }

  .problem-reader.dock-left {
    order: -1;
    border-right: 1px solid var(--border-strong);
    border-left: 0;
  }

  .problem-reader-resize {
    position: absolute;
    z-index: 5;
    inset: 0 auto 0 -4px;
    width: 10px;
    cursor: ew-resize;
  }

  .problem-reader-resize::before,
  .problem-reader-resize::after {
    position: absolute;
    content: "";
  }

  .problem-reader-resize::before {
    top: calc(50% - 24px);
    left: 3px;
    width: 3px;
    height: 48px;
    border-radius: 999px;
    background: var(--border-strong);
  }

  .problem-reader-resize::after {
    inset: 0 auto 0 4px;
    width: 2px;
    background: transparent;
  }

  .problem-reader.dock-left .problem-reader-resize {
    inset: 0 -5px 0 auto;
  }

  .problem-reader-resize:hover::after,
  .problem-reader-resize:focus-visible::after {
    background: var(--accent);
  }

  .problem-reader-resize:hover::before,
  .problem-reader-resize:focus-visible::before {
    background: var(--accent);
  }

  .problem-reader-header-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }

  .problem-reader-header-actions button {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    place-items: center;
    border-radius: 4px;
    color: var(--text-muted);
    background: transparent;
  }

  .problem-reader-header-actions button:hover {
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .problem-reader-toolbar {
    display: flex;
    min-height: 39px;
    flex: 0 0 39px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .problem-reader-actions,
  .reader-toolbar-end,
  .reader-view-switch {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .reader-toolbar-end {
    min-width: 0;
    flex: 0 0 auto;
  }

  .problem-reader-actions button {
    display: inline-flex;
    min-height: 27px;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    font-size: var(--ui-font-caption);
  }

  .problem-reader-actions button:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .reader-view-switch {
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-sunken);
  }

  .reader-view-switch button {
    min-height: 23px;
    padding: 0 8px;
    border-radius: 3px;
    color: var(--text-muted);
    background: transparent;
    font-size: var(--ui-font-caption);
  }

  .reader-view-switch button.active {
    color: var(--text-primary);
    background: var(--active-background);
  }

  .reader-view-switch button:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }

  @container (max-width: 390px) {
    .problem-reader-actions button span {
      display: none;
    }

    .problem-reader-actions button {
      width: 27px;
      justify-content: center;
      padding: 0;
    }

    .reader-view-switch button {
      padding-inline: 6px;
    }
  }

  .reader-file-input {
    display: none;
  }

  .problem-reader-body {
    min-width: 0;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .reader-editor {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
  }

  .reader-editor textarea {
    width: 100%;
    min-height: 0;
    flex: 1;
    resize: none;
    padding: 18px;
    border: 0;
    border-radius: 0;
    outline: 0;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--editor-background) 88%, transparent);
    font: 13px/1.65 var(--editor-font-family);
    tab-size: 2;
  }

  .reader-editor textarea:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .reader-editor footer {
    display: flex;
    min-height: 43px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
  }

  .reader-editor footer button {
    min-height: 29px;
  }

  .reader-markdown {
    height: 100%;
    overflow: auto;
    padding: 24px clamp(20px, 6%, 42px) 64px;
    color: var(--text-secondary);
    font: 14px/1.75 var(--ui-font);
    overflow-wrap: anywhere;
  }

  .reader-markdown :global(h1),
  .reader-markdown :global(h2),
  .reader-markdown :global(h3) {
    color: var(--text-primary);
    font-family: var(--display-font);
    line-height: 1.3;
  }

  .reader-markdown :global(h1) {
    margin: 0 0 22px;
    padding-bottom: 13px;
    border-bottom: 1px solid var(--border-strong);
    font-size: 24px;
    font-weight: 720;
    letter-spacing: -0.02em;
  }

  .reader-markdown :global(h2) {
    margin: 30px 0 12px;
    padding-left: 10px;
    border-left: 3px solid var(--accent);
    font-size: 18px;
  }

  .reader-markdown :global(h3) {
    margin: 24px 0 9px;
    font-size: 15px;
  }

  .reader-markdown :global(p),
  .reader-markdown :global(ul),
  .reader-markdown :global(ol),
  .reader-markdown :global(blockquote),
  .reader-markdown :global(pre),
  .reader-markdown :global(table) {
    margin: 0 0 16px;
  }

  .reader-markdown :global(ul),
  .reader-markdown :global(ol) {
    padding-left: 22px;
  }

  .reader-markdown :global(li + li) {
    margin-top: 5px;
  }

  .reader-markdown :global(a) {
    color: var(--accent-strong);
    text-underline-offset: 3px;
  }

  .reader-markdown :global(blockquote) {
    padding: 10px 13px;
    border-left: 3px solid var(--border-strong);
    color: var(--text-muted);
    background: var(--surface-sunken);
  }

  .reader-markdown :global(code) {
    padding: 2px 5px;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    color: var(--text-primary);
    background: var(--surface-sunken);
    font: 12px/1.55 var(--editor-font-family);
  }

  .reader-markdown :global(.reader-code-block) {
    position: relative;
    margin: 0 0 16px;
  }

  .reader-markdown :global(.reader-code-actions) {
    position: absolute;
    z-index: 2;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 5px;
  }

  .reader-markdown :global(.reader-code-actions button) {
    min-height: 27px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--shadow) 25%, transparent);
    font: 600 var(--ui-font-caption)/1 var(--ui-font);
    backdrop-filter: blur(5px);
  }

  .reader-markdown :global(.reader-code-actions button:hover) {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong));
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .reader-markdown :global(.reader-code-actions button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .reader-markdown :global(.reader-code-actions button:disabled) {
    cursor: default;
    opacity: 0.62;
  }

  .reader-markdown :global(pre) {
    overflow: auto;
    margin: 0;
    padding: 45px 14px 13px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--editor-background) 92%, black);
  }

  .reader-markdown :global(pre code) {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .reader-markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .reader-markdown :global(th),
  .reader-markdown :global(td) {
    padding: 7px 9px;
    border: 1px solid var(--border);
    text-align: left;
  }

  .reader-markdown :global(th) {
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .reader-markdown :global(img) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 18px auto;
    border-radius: 5px;
  }

  .reader-markdown :global(hr) {
    margin: 26px 0;
    border: 0;
    border-top: 1px solid var(--border-strong);
  }

  .reader-markdown :global(.katex) {
    color: var(--text-primary);
    font-size: 1.02em;
  }

  .reader-markdown :global(.katex-display) {
    overflow-x: auto;
    overflow-y: hidden;
    padding: 5px 0;
  }

  .reader-pdf {
    width: 100%;
    height: 100%;
    border: 0;
    background: #303338;
  }

  .reader-empty,
  .reader-loading {
    display: flex;
    height: 100%;
    min-height: 250px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    padding: 28px;
    color: var(--text-muted);
    text-align: center;
  }

  .reader-empty-icon {
    display: grid;
    width: 52px;
    height: 52px;
    margin-bottom: 4px;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: 10px 10px 10px 2px;
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  .reader-empty strong {
    color: var(--text-primary);
    font-size: 16px;
  }

  .reader-empty p {
    max-width: 360px;
    margin: 0;
    line-height: 1.65;
  }

  .reader-empty > div {
    display: flex;
    gap: 7px;
    margin-top: 5px;
  }

  .reader-empty button {
    min-height: 32px;
    padding-inline: 10px;
  }

  .reader-empty small {
    margin-top: 3px;
    font-size: var(--ui-font-caption);
  }

  .reader-loading span {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: reader-spin 700ms linear infinite;
  }

  .reader-loading p {
    margin: 0;
  }

  .reader-drop-overlay {
    position: absolute;
    z-index: 10;
    inset: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    border: 1px dashed var(--accent);
    border-radius: 8px;
    color: var(--accent-strong);
    background: color-mix(in srgb, var(--panel-background) 90%, transparent);
    backdrop-filter: blur(6px);
    pointer-events: none;
  }

  .reader-drop-overlay span {
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
  }

  @keyframes reader-spin {
    to { transform: rotate(360deg); }
  }

  @container (max-width: 720px) {
    .problem-reader {
      position: absolute;
      z-index: 20;
      inset: 0 0 0 auto;
      width: min(92%, 560px) !important;
      min-width: min(300px, 92%);
      box-shadow: -18px 0 42px color-mix(in srgb, var(--shadow) 58%, transparent);
    }

    .problem-reader.dock-left {
      inset: 0 auto 0 0;
      box-shadow: 18px 0 42px color-mix(in srgb, var(--shadow) 58%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reader-loading span { animation: none; }
  }
</style>
