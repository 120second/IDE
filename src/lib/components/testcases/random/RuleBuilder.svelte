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

  interface Props {
    nodes: VisualNode[];
    diagnostics: VisualDiagnostic[];
    change: (nodes: VisualNode[]) => void;
  }

  let { nodes, diagnostics, change }: Props = $props();

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

  function applyTemplate(template: GeneratorTemplateId): void {
    if (!window.confirm("应用模板会替换当前生成规则，是否继续？")) return;
    change(createTemplate(template));
  }
</script>

<section class="rule-builder">
  <header>
    <div><strong>生成规则</strong><span>按照题目的输入格式，从上到下搭建。</span></div>
    <div><AddRuleMenu depth={0} {add} compact /><TemplateMenu apply={applyTemplate} /></div>
  </header>

  <div class="rule-list">
    {#each nodes as node, index (node.id)}
      <RuleNode
        {node}
        {index}
        total={nodes.length}
        scope={scopeBefore(nodes, index)}
        depth={0}
        {diagnostics}
        change={(updated) => update(index, updated)}
        duplicate={() => duplicate(index)}
        move={(direction) => move(index, direction)}
        remove={() => change(nodes.filter((_, candidateIndex) => candidateIndex !== index))}
      />
    {/each}
    {#if nodes.length === 0}<div class="rule-list-empty">尚未添加规则。可以从常用模板开始。</div>{/if}
  </div>
  <button class="add-line-button" onclick={() => add("integer")}>＋ 添加一行</button>
</section>
