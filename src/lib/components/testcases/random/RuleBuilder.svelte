<script lang="ts">
  import {
    arrayField,
    cloneNode,
    constant,
    createTemplate,
    graphNode,
    integerField,
    line,
    newRuleId,
    repeatNode,
    scopeBefore,
    suggestIntegerName,
    treeNode,
    testCaseWrapper,
    toggleTestCases,
    variable,
    wrapNodesInRepeat,
    type GeneratorTemplateId,
  } from "../../../generator/visualRules";
  import type { VisualDiagnostic, VisualNode } from "../../../types/generator";
  import AddRuleMenu, { type AddRuleKind } from "./AddRuleMenu.svelte";
  import Icon from "../../shell/Icon.svelte";
  import RuleNode from "./RuleNode.svelte";
  import TemplateMenu from "./TemplateMenu.svelte";
  import type { UxStore } from "../../../stores/ux.svelte";
  import { detectPreset, FORMAT_PRESETS } from "../../../generator/formatPresets";

  interface Props {
    nodes: VisualNode[];
    diagnostics: VisualDiagnostic[];
    change: (nodes: VisualNode[]) => void;
    ux: UxStore;
    busy?: boolean;
  }

  let { nodes, diagnostics, change, ux, busy = false }: Props = $props();
  let replacedNodes = $state.raw<VisualNode[]>();
  let selectedPreset = $derived(detectPreset(nodes));
  let multiTest = $derived(Boolean(testCaseWrapper(nodes)));

  function clearAll(): void {
    if (busy || nodes.length === 0) return;
    replacedNodes = nodes;
    change([]);
  }

  function add(kind: AddRuleKind): void {
    const scope = scopeBefore(nodes, nodes.length);
    const size = scope.includes("n") ? "n" : scope.at(-1);
    const edges = scope.includes("m") ? "m" : undefined;
    const node: VisualNode = kind === "integer" ? line([integerField(suggestIntegerName(scope))])
      : kind === "array" ? line([arrayField("a", size ? variable(size) : constant(10))])
      : kind === "string" ? line([{ type: "string", id: newRuleId("field"), name: "s", length: size ? variable(size) : constant(10), alphabet: "lowercase" }])
      : kind === "permutation" ? line([{ type: "permutation", id: newRuleId("field"), name: "p", length: size ? variable(size) : constant(10) }])
      : kind === "repeat" ? repeatNode(scope)
      : kind === "tree" ? treeNode(size ? variable(size) : constant(10))
      : kind === "graph" ? graphNode(size ? variable(size) : constant(10), edges ? variable(edges) : constant(10))
      : { type: "matrix", id: newRuleId("matrix"), name: "mat", rows: size ? variable(size) : constant(10), columns: size ? variable(size) : constant(10), minimum: constant(1), maximum: constant(1000) };
    change([...nodes, node]);
  }

  function update(index: number, node: VisualNode): void {
    change(nodes.map((candidate, candidateIndex) => candidateIndex === index ? node : candidate));
  }

  function duplicate(index: number): void {
    const next = [...nodes];
    next.splice(index + 1, 0, cloneNode(nodes[index]));
    change(next);
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    [next[index], next[target]] = [next[target], next[index]];
    change(next);
  }

  function wrapFrom(index: number): void {
    const next = wrapNodesInRepeat(nodes, index);
    change(next);
  }

  function applyTemplate(template: GeneratorTemplateId): void {
    if (busy) return;
    if (selectedPreset === template) return;
    replacedNodes = nodes;
    const next = createTemplate(template);
    change(multiTest && template !== "multiTest" ? toggleTestCases(next) : next);
  }

  function restore(): void {
    if (!replacedNodes || busy) return;
    change(replacedNodes);
    replacedNodes = undefined;
  }
</script>

<section class="rule-builder">
  <header class="input-format-header">
    <div><strong>输入格式</strong><span>先选结构，再改范围</span></div>
    <div class="input-format-actions">
      {#if replacedNodes}<button type="button" class="format-restore" disabled={busy} onclick={restore} title="恢复替换或清空之前的输入格式"><Icon name="undo" size={13} />恢复之前的格式</button>{/if}
    </div>
  </header>
  <div class="format-preset-grid" role="group" aria-label="常用输入格式">
    {#each FORMAT_PRESETS as preset}
      <button type="button" class:active={selectedPreset === preset.id} aria-pressed={selectedPreset === preset.id} disabled={busy} onclick={() => applyTemplate(preset.id)}><strong>{preset.title}</strong><span>{preset.example}</span></button>
    {/each}
  </div>
  <div class="format-options">
    <label class="format-multi-test"><input type="checkbox" checked={multiTest} disabled={busy || !nodes.length} onchange={() => { replacedNodes = nodes; change(toggleTestCases(nodes)); }} />多组测试 T</label>
    <TemplateMenu apply={applyTemplate} label="其他格式…" disabled={busy} />
  </div>
  <div class="format-edit-heading"><strong>编辑参数</strong><span title="支持加减乘除、取余和括号，除法取整">支持 <code>3n</code>、<code>n*m</code>、<code>(n+1)/2</code></span></div>

  <fieldset class="format-rule-controls" disabled={busy} aria-label="编辑输入参数">
  <div class="rule-list">
    {#each nodes as node, index (node.id)}
      <RuleNode
        {node}
        {index}
        total={nodes.length}
        scope={scopeBefore(nodes, index)}
        depth={0}
        position={String(index + 1)}
        startExpanded={true}
        {diagnostics}
        {ux}
        change={(updated) => update(index, updated)}
        duplicate={() => duplicate(index)}
        move={(direction) => move(index, direction)}
        wrapFollowing={() => wrapFrom(index)}
        remove={() => change(nodes.filter((_, candidateIndex) => candidateIndex !== index))}
      />
    {/each}
    {#if nodes.length === 0}<div class="rule-list-empty"><strong>还没有输入格式</strong><span>选择一个常用格式，或添加第一行数据。</span></div>{/if}
  </div>
  <div class="rule-composer" aria-label="添加输入结构">
    <div class="rule-composer-actions">
      <span>添加</span>
      <button type="button" class="secondary-button" onclick={() => add("integer")}><Icon name="plus" size={13} />输入行</button>
      <button type="button" class="secondary-button" onclick={() => add("array")}>数组</button>
      <button type="button" class="secondary-button repeat-action" onclick={() => add("repeat")}><Icon name="repeat" size={13} />循环</button>
      <AddRuleMenu {add} compact label="更多类型" />
    </div>
  </div>
  <button type="button" class="format-clear" onclick={clearAll} disabled={busy || !nodes.length}><Icon name="trash" size={13} />清空格式</button>
  </fieldset>
</section>
