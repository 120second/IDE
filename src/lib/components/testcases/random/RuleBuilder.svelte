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
    scopeBefore,
    treeNode,
    variable,
    type GeneratorTemplateId,
  } from "../../../generator/visualRules";
  import type { VisualDiagnostic, VisualNode } from "../../../types/generator";
  import AddRuleMenu, { type AddRuleKind } from "./AddRuleMenu.svelte";
  import RuleNode from "./RuleNode.svelte";
  import TemplateMenu from "./TemplateMenu.svelte";
  import type { UxStore } from "../../../stores/ux.svelte";

  interface Props {
    nodes: VisualNode[];
    diagnostics: VisualDiagnostic[];
    change: (nodes: VisualNode[]) => void;
    ux: UxStore;
  }

  let { nodes, diagnostics, change, ux }: Props = $props();
  const quickTemplates: Array<{ id: GeneratorTemplateId; label: string }> = [
    { id: "nArray", label: "n + 数组" },
    { id: "nmEdges", label: "n m + 边" },
    { id: "multiTest", label: "T 组测试" },
    { id: "tree", label: "树" },
  ];

  function add(kind: AddRuleKind): void {
    const scope = scopeBefore(nodes, nodes.length);
    const size = scope.includes("n") ? "n" : scope.at(-1);
    const edges = scope.includes("m") ? "m" : undefined;
    const node: VisualNode = kind === "integer" ? line([integerField(`x${nodes.length + 1}`)])
      : kind === "array" ? line([arrayField("a", size ? variable(size) : constant(10))])
      : kind === "string" ? line([{ type: "string", id: newRuleId("field"), name: "s", length: size ? variable(size) : constant(10), alphabet: "lowercase" }])
      : kind === "permutation" ? line([{ type: "permutation", id: newRuleId("field"), name: "p", length: size ? variable(size) : constant(10) }])
      : kind === "repeat" ? { type: "repeat", id: newRuleId("repeat"), count: scope.at(-1) ? variable(scope.at(-1)!) : constant(1), children: [line([integerField("x")])] }
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

  async function applyTemplate(template: GeneratorTemplateId): Promise<void> {
    if (!await ux.confirm({
      title: "替换输入格式",
      message: "应用模板会替换当前生成规则。已保存的固定测试点不会受到影响。",
      confirmLabel: "应用模板",
      danger: true,
    })) return;
    change(createTemplate(template));
  }
</script>

<section class="rule-builder">
  <header class="generator-step-header">
    <span class="generator-step-index" aria-hidden="true">1</span>
    <div class="generator-step-copy"><strong>输入格式</strong><span>按程序读取数据的顺序，从上到下搭建。</span></div>
    <span class="rule-count">{nodes.length} 项</span>
  </header>

  <div class="template-launcher">
    <span>常用结构</span>
    <div class="template-shortcuts" aria-label="常用输入格式模板">
      {#each quickTemplates as template}
        <button type="button" onclick={() => applyTemplate(template.id)}>{template.label}</button>
      {/each}
      <TemplateMenu apply={applyTemplate} label="更多…" />
    </div>
  </div>

  <div class="rule-builder-toolbar">
    <span>每一项对应输入中的一行或一组结构</span>
    <AddRuleMenu depth={0} {add} compact />
  </div>

  <div class="rule-list">
    {#each nodes as node, index (node.id)}
      <RuleNode
        {node}
        {index}
        total={nodes.length}
        scope={scopeBefore(nodes, index)}
        depth={0}
        position={String(index + 1)}
        {diagnostics}
        {ux}
        change={(updated) => update(index, updated)}
        duplicate={() => duplicate(index)}
        move={(direction) => move(index, direction)}
        remove={() => change(nodes.filter((_, candidateIndex) => candidateIndex !== index))}
      />
    {/each}
    {#if nodes.length === 0}<div class="rule-list-empty"><strong>还没有输入结构</strong><span>选择上方模板，或者添加第一项输入内容。</span></div>{/if}
  </div>
  <button class="add-line-button" onclick={() => add("integer")}>＋ 添加输入内容</button>
</section>
