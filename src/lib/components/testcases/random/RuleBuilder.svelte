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

  interface Props {
    nodes: VisualNode[];
    diagnostics: VisualDiagnostic[];
    change: (nodes: VisualNode[]) => void;
    ux: UxStore;
    busy?: boolean;
  }

  let { nodes, diagnostics, change, ux, busy = false }: Props = $props();
  let newestNodeId = $state("");

  function clearAll(): void {
    if (busy || nodes.length === 0) return;
    newestNodeId = "";
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
    newestNodeId = node.id;
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
    newestNodeId = next[index]?.id ?? "";
    change(next);
  }

  async function applyTemplate(template: GeneratorTemplateId): Promise<void> {
    if (!await ux.confirm({
      title: "替换输入格式",
      message: "应用模板会替换当前生成规则。已保存的固定测试点不会受到影响。",
      confirmLabel: "应用模板",
      danger: true,
    })) return;
    newestNodeId = "";
    change(createTemplate(template));
  }
</script>

<section class="rule-builder">
  <header class="input-format-header">
    <div><strong>输入格式</strong><span>{nodes.length} 项</span></div>
    <div class="input-format-actions">
      <button type="button" class="secondary-button" onclick={clearAll} disabled={busy || nodes.length === 0} title="清空所有输入规则和循环内容"><Icon name="trash" size={13} />一键清空</button>
      <TemplateMenu apply={applyTemplate} label="套用常用格式…" />
    </div>
  </header>
  <p class="input-format-hint">从上到下生成数据，循环内的内容会重复。点击任意一项可编辑。</p>

  <div class="rule-list">
    {#each nodes as node, index (node.id)}
      <RuleNode
        {node}
        {index}
        total={nodes.length}
        scope={scopeBefore(nodes, index)}
        depth={0}
        position={String(index + 1)}
        startExpanded={node.id === newestNodeId}
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
      <button type="button" class="secondary-button repeat-action" onclick={() => add("repeat")}><Icon name="repeat" size={13} />循环</button>
      <AddRuleMenu {add} compact label="更多类型" />
    </div>
  </div>
</section>
