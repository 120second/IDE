<script lang="ts">
  import {
    arrayField,
    cloneNode,
    constant,
    expressionLabel,
    fieldLabel,
    graphNode,
    integerField,
    line,
    newRuleId,
    nodeDiagnostics,
    scopeBefore,
    treeNode,
    TREE_SHAPES,
    variable,
  } from "../../../generator/visualRules";
  import type {
    GeneratorStrategy,
    TreeShape,
    VisualDiagnostic,
    VisualNode,
  } from "../../../types/generator";
  import AddRuleMenu, { type AddRuleKind } from "./AddRuleMenu.svelte";
  import LineRule from "./LineRule.svelte";
  import RecursiveRuleNode from "./RuleNode.svelte";
  import ValueExpressionInput from "./ValueExpressionInput.svelte";

  interface Props {
    node: VisualNode;
    index: number;
    total: number;
    scope: string[];
    depth: number;
    diagnostics: VisualDiagnostic[];
    change: (node: VisualNode) => void;
    duplicate: () => void;
    move: (direction: -1 | 1) => void;
    remove: () => void;
  }

  let { node, index, total, scope, depth, diagnostics, change, duplicate, move, remove }: Props = $props();
  let expanded = $state(false);
  let ownDiagnostics = $derived(nodeDiagnostics(diagnostics, node.id));
  let invalid = $derived(ownDiagnostics.length > 0);

  function title(): string {
    if (node.type === "line") return `第 ${index + 1} 行`;
    if (node.type === "repeat") return `重复 ${expressionLabel(node.count)} 次`;
    if (node.type === "tree") return node.weight ? "带权树" : "树";
    if (node.type === "graph") return node.kind === "dag" ? "有向无环图" : node.kind === "connectedUndirected" ? "连通无向图" : "简单无向图";
    return "矩阵";
  }

  function summary(): string {
    if (node.type === "line") {
      const fields = node.fields.map((field) => {
        if (field.type === "array" && field.length.type === "variable" && !scope.includes(field.length.name)) {
          return `${field.name || "?"}[?]`;
        }
        return fieldLabel(field);
      }).join("    ") || "空行";
      return invalid ? `${fields} · ⚠ ${ownDiagnostics[0].message}` : fields;
    }
    if (node.type === "repeat") return `${node.children.length} 条子规则`;
    if (node.type === "tree") return `${expressionLabel(node.nodes)} 个节点 · ${node.shape ? TREE_SHAPES.find((item) => item.value === node.shape)?.label : "继承树形"}${node.weight ? ` · 权值 ${expressionLabel(node.weight.minimum)}~${expressionLabel(node.weight.maximum)}` : ""}`;
    if (node.type === "graph") return `n=${expressionLabel(node.nodes)} · m=${expressionLabel(node.edges)} · ${node.indexBase === 0 ? "0 起点" : "1 起点"}`;
    return `${node.name}[${expressionLabel(node.rows)}][${expressionLabel(node.columns)}] · ${expressionLabel(node.minimum)}~${expressionLabel(node.maximum)}`;
  }

  function createNode(kind: AddRuleKind, available: string[]): VisualNode {
    const size = available.includes("n") ? "n" : available.at(-1);
    const edges = available.includes("m") ? "m" : undefined;
    if (kind === "integer") return line([integerField(`x${index + 1}`)]);
    if (kind === "array") return line([arrayField("a", size ? variable(size) : constant(10))]);
    if (kind === "string") return line([{ type: "string", id: newRuleId("field"), name: "s", length: size ? variable(size) : constant(10), alphabet: "lowercase" }]);
    if (kind === "permutation") return line([{ type: "permutation", id: newRuleId("field"), name: "p", length: size ? variable(size) : constant(10) }]);
    if (kind === "repeat") return { type: "repeat", id: newRuleId("repeat"), count: available.at(-1) ? variable(available.at(-1)!) : constant(1), children: [line([integerField("x")])] };
    if (kind === "tree") return treeNode(size ? variable(size) : constant(10));
    if (kind === "graph") return graphNode(size ? variable(size) : constant(10), edges ? variable(edges) : constant(10));
    return { type: "matrix", id: newRuleId("matrix"), name: "mat", rows: size ? variable(size) : constant(10), columns: size ? variable(size) : constant(10), minimum: constant(1), maximum: constant(1000) };
  }

  function addChild(kind: AddRuleKind): void {
    if (node.type !== "repeat") return;
    const available = scopeBefore(node.children, node.children.length, scope);
    change({ ...node, children: [...node.children, createNode(kind, available)] });
  }

  function updateChild(childIndex: number, child: VisualNode): void {
    if (node.type !== "repeat") return;
    change({ ...node, children: node.children.map((candidate, index) => index === childIndex ? child : candidate) });
  }

  function duplicateChild(childIndex: number): void {
    if (node.type !== "repeat") return;
    const children = [...node.children];
    children.splice(childIndex + 1, 0, cloneNode(node.children[childIndex]));
    change({ ...node, children });
  }

  function moveChild(childIndex: number, direction: -1 | 1): void {
    if (node.type !== "repeat") return;
    const target = childIndex + direction;
    if (target < 0 || target >= node.children.length) return;
    const children = [...node.children];
    [children[childIndex], children[target]] = [children[target], children[childIndex]];
    change({ ...node, children });
  }

  function removeChild(childIndex: number): void {
    if (node.type !== "repeat") return;
    change({ ...node, children: node.children.filter((_, index) => index !== childIndex) });
  }
</script>

<article class:invalid class:expanded class="rule-node" style:--rule-depth={depth}>
  <div class="rule-node-header">
    <button class="rule-node-main" onclick={() => (expanded = !expanded)}>
      <span class="rule-chevron">{expanded ? "▾" : "▸"}</span>
      <span><strong>{title()}</strong><small>{summary()}</small></span>
    </button>
    <div class="rule-node-actions">
      <button title="编辑" onclick={() => (expanded = !expanded)}>✎</button>
      <button title="复制" onclick={duplicate}>⧉</button>
      <button title="上移" disabled={index === 0} onclick={() => move(-1)}>↑</button>
      <button title="下移" disabled={index === total - 1} onclick={() => move(1)}>↓</button>
      <button title="删除" onclick={remove}>×</button>
    </div>
  </div>

  {#if expanded}
    <div class="rule-node-editor">
      {#if node.type === "line"}
        <LineRule {node} {scope} {diagnostics} {change} />
      {:else if node.type === "repeat"}
        <ValueExpressionInput label="重复次数" value={node.count} variables={scope} change={(count) => change({ ...node, count })} />
        <div class="repeat-children">
          {#each node.children as child, childIndex (child.id)}
            <RecursiveRuleNode
              node={child}
              index={childIndex}
              total={node.children.length}
              scope={scopeBefore(node.children, childIndex, scope)}
              depth={depth + 1}
              {diagnostics}
              change={(updated) => updateChild(childIndex, updated)}
              duplicate={() => duplicateChild(childIndex)}
              move={(direction) => moveChild(childIndex, direction)}
              remove={() => removeChild(childIndex)}
            />
          {/each}
          <AddRuleMenu depth={depth + 1} add={addChild} compact />
        </div>
      {:else if node.type === "tree"}
        <ValueExpressionInput label="节点数" value={node.nodes} variables={scope} change={(nodes) => change({ ...node, nodes })} />
        <div class="rule-inline-fields">
          <label><span>编号方式</span><select value={node.indexBase} onchange={(event) => change({ ...node, indexBase: Number(event.currentTarget.value) as 0 | 1 })}><option value={1}>1 ～ n</option><option value={0}>0 ～ n-1</option></select></label>
          <label><span>树的形态</span><select value={node.shape ?? ""} onchange={(event) => change({ ...node, shape: event.currentTarget.value ? event.currentTarget.value as TreeShape : undefined })}><option value="">继承默认值</option>{#each TREE_SHAPES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
        </div>
        <label class="rule-checkbox"><input type="checkbox" checked={Boolean(node.weight)} onchange={(event) => change({ ...node, weight: event.currentTarget.checked ? { minimum: constant(1), maximum: constant(1_000_000_000) } : undefined })} /> 带权边</label>
        {#if node.weight}<div class="range-editor"><ValueExpressionInput label="权值下界" value={node.weight.minimum} variables={scope} change={(minimum) => change({ ...node, weight: { ...node.weight!, minimum } })} /><span>～</span><ValueExpressionInput label="权值上界" value={node.weight.maximum} variables={scope} change={(maximum) => change({ ...node, weight: { ...node.weight!, maximum } })} /></div>{/if}
      {:else if node.type === "graph"}
        <div class="rule-inline-fields"><ValueExpressionInput label="节点数" value={node.nodes} variables={scope} change={(nodes) => change({ ...node, nodes })} /><ValueExpressionInput label="边数" value={node.edges} variables={scope} change={(edges) => change({ ...node, edges })} /></div>
        <div class="rule-inline-fields">
          <label><span>图类型</span><select value={node.kind} onchange={(event) => change({ ...node, kind: event.currentTarget.value as typeof node.kind })}><option value="simpleUndirected">简单无向图</option><option value="connectedUndirected">连通无向图</option><option value="dag">有向无环图</option></select></label>
          <label><span>编号方式</span><select value={node.indexBase} onchange={(event) => change({ ...node, indexBase: Number(event.currentTarget.value) as 0 | 1 })}><option value={1}>1 ～ n</option><option value={0}>0 ～ n-1</option></select></label>
        </div>
      {:else}
        <label><span>名称</span><input value={node.name} oninput={(event) => change({ ...node, name: event.currentTarget.value })} /></label>
        <div class="rule-inline-fields"><ValueExpressionInput label="行数" value={node.rows} variables={scope} change={(rows) => change({ ...node, rows })} /><ValueExpressionInput label="列数" value={node.columns} variables={scope} change={(columns) => change({ ...node, columns })} /></div>
        <div class="range-editor"><ValueExpressionInput label="元素下界" value={node.minimum} variables={scope} change={(minimum) => change({ ...node, minimum })} /><span>～</span><ValueExpressionInput label="元素上界" value={node.maximum} variables={scope} change={(maximum) => change({ ...node, maximum })} /></div>
      {/if}

      {#each ownDiagnostics.filter((diagnostic) => !diagnostic.fieldId) as diagnostic}<p class="rule-error">{diagnostic.message}</p>{/each}
    </div>
  {/if}
</article>
