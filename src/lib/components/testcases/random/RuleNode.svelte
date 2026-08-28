<script lang="ts">
  import {
    arrayField,
    cloneNode,
    constant,
    expressionLabel,
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
    TreeShape,
    VisualDiagnostic,
    VisualField,
    VisualNode,
  } from "../../../types/generator";
  import ContextMenu from "../../ux/ContextMenu.svelte";
  import Icon from "../../shell/Icon.svelte";
  import AddRuleMenu, { type AddRuleKind } from "./AddRuleMenu.svelte";
  import LineRule from "./LineRule.svelte";
  import RecursiveRuleNode from "./RuleNode.svelte";
  import ValueExpressionInput from "./ValueExpressionInput.svelte";
  import type { UxStore } from "../../../stores/ux.svelte";

  interface Props {
    node: VisualNode;
    index: number;
    total: number;
    scope: string[];
    depth: number;
    position?: string;
    diagnostics: VisualDiagnostic[];
    change: (node: VisualNode) => void;
    duplicate: () => void;
    move: (direction: -1 | 1) => void;
    remove: () => void;
    ux: UxStore;
  }

  let { node, index, total, scope, depth, position, diagnostics, change, duplicate, move, remove, ux }: Props = $props();
  let expanded = $state(false);
  let actionMenu = $state<{ x: number; y: number }>();
  let ownDiagnostics = $derived(nodeDiagnostics(diagnostics, node.id));
  let invalid = $derived(ownDiagnostics.length > 0);
  let orderLabel = $derived(position ?? String(index + 1));

  function fieldName(field: VisualField): string {
    return field.name.trim() || "未命名";
  }

  function lineTitle(fields: VisualField[]): string {
    if (fields.length === 0) return "空输入行";
    if (fields.every((field) => field.type === "integer")) {
      return fields.length === 1
        ? `读取整数 ${fieldName(fields[0])}`
        : `读取 ${fields.length} 个整数：${fields.map(fieldName).join("、")}`;
    }
    if (fields.length === 1) {
      const field = fields[0];
      if (field.type === "array") return `读取 ${expressionLabel(field.length)} 个整数到数组 ${fieldName(field)}`;
      if (field.type === "string") return `读取长度为 ${expressionLabel(field.length)} 的${field.alphabet === "binary" ? "二进制" : "小写字母"}字符串 ${fieldName(field)}`;
      if (field.type === "permutation") return `读取长度为 ${expressionLabel(field.length)} 的排列 ${fieldName(field)}`;
    }
    return `读取一行数据：${fields.map(fieldName).join("、")}`;
  }

  function fieldSummary(field: VisualField): string {
    if (field.type === "integer") return `${fieldName(field)} 为 ${expressionLabel(field.minimum)}～${expressionLabel(field.maximum)}`;
    if (field.type === "array") return `元素范围 ${expressionLabel(field.minimum)}～${expressionLabel(field.maximum)}`;
    if (field.type === "string") return `字符集：${field.alphabet === "binary" ? "0 和 1" : "小写英文字母"}`;
    return `元素为 1～${expressionLabel(field.length)}，每个值出现一次`;
  }

  function title(): string {
    if (node.type === "line") return lineTitle(node.fields);
    if (node.type === "repeat") return `重复 ${expressionLabel(node.count)} 次`;
    if (node.type === "tree") return `生成 ${expressionLabel(node.nodes)} 个节点的${node.weight ? "带权树" : "树"}`;
    if (node.type === "graph") {
      const kind = node.kind === "dag" ? "有向无环图" : node.kind === "connectedUndirected" ? "连通无向图" : "简单无向图";
      return `生成 ${expressionLabel(node.nodes)} 个节点、${expressionLabel(node.edges)} 条边的${kind}`;
    }
    return `生成 ${expressionLabel(node.rows)} × ${expressionLabel(node.columns)} 的矩阵 ${node.name || "mat"}`;
  }

  function summary(): string {
    let description: string;
    if (node.type === "line") {
      description = node.fields.map(fieldSummary).join(" · ") || "这一行还没有内容";
    } else if (node.type === "repeat") {
      description = `以下 ${node.children.length} 项输入内容会按顺序重复`;
    } else if (node.type === "tree") {
      const shape = node.shape ? TREE_SHAPES.find((item) => item.value === node.shape)?.label : "使用默认树形";
      description = `节点编号从 ${node.indexBase} 开始 · ${shape}${node.weight ? ` · 权值 ${expressionLabel(node.weight.minimum)}～${expressionLabel(node.weight.maximum)}` : ""}`;
    } else if (node.type === "graph") {
      description = `节点编号从 ${node.indexBase} 开始`;
    } else {
      description = `元素范围 ${expressionLabel(node.minimum)}～${expressionLabel(node.maximum)}`;
    }
    return invalid ? `需要修复：${ownDiagnostics[0]?.message ?? description}` : description;
  }

  function openActionMenu(event: MouseEvent): void {
    const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined;
    if (!bounds) return;
    actionMenu = { x: bounds.right - 132, y: bounds.bottom + 4 };
  }

  async function requestRemove(): Promise<void> {
    if (await ux.confirm({
      title: "删除输入规则",
      message: `确定删除“${title()}”吗？`,
      confirmLabel: "删除规则",
      danger: true,
    })) remove();
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

<article class:invalid class:expanded class:repeat-node={node.type === "repeat"} class="rule-node" style:--rule-depth={depth}>
  <div class="rule-node-header">
    <span class="rule-order" aria-hidden="true">{orderLabel}</span>
    <button type="button" class="rule-node-main" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
      <span><strong>{title()}</strong><small>{summary()}</small></span>
    </button>
    <div class="rule-node-actions">
      <button type="button" class="rule-edit-button" aria-label={expanded ? "收起规则编辑" : "编辑生成规则"} aria-expanded={expanded} onclick={() => (expanded = !expanded)}><Icon name="edit" size={12} /><span>{expanded ? "收起" : "编辑"}</span></button>
      <button type="button" class="rule-more-button" aria-label="更多规则操作" aria-haspopup="menu" aria-expanded={Boolean(actionMenu)} onclick={openActionMenu}>…</button>
    </div>
  </div>

  {#if expanded}
    <div class="rule-node-editor">
      {#if node.type === "line"}
        <LineRule {node} {scope} {diagnostics} {change} />
      {:else if node.type === "repeat"}
        <ValueExpressionInput label="重复次数" value={node.count} variables={scope} change={(count) => change({ ...node, count })} />
        <p class="rule-editor-hint">下方内容会完整重复，可继续添加或调整其中的输入项。</p>
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

  {#if node.type === "repeat"}
    <div class="repeat-flow">
      <span class="repeat-flow-label">每次按以下顺序生成</span>
      <div class="repeat-children">
        {#each node.children as child, childIndex (child.id)}
          <RecursiveRuleNode
            node={child}
            index={childIndex}
            total={node.children.length}
            scope={scopeBefore(node.children, childIndex, scope)}
            depth={depth + 1}
            position={`${orderLabel}.${childIndex + 1}`}
            {diagnostics}
            {ux}
            change={(updated) => updateChild(childIndex, updated)}
            duplicate={() => duplicateChild(childIndex)}
            move={(direction) => moveChild(childIndex, direction)}
            remove={() => removeChild(childIndex)}
          />
        {/each}
        <div class="repeat-add-row"><AddRuleMenu depth={depth + 1} add={addChild} compact label="添加到重复块" /></div>
      </div>
    </div>
  {/if}
</article>

{#if actionMenu}
  <ContextMenu
    x={actionMenu.x}
    y={actionMenu.y}
    close={() => (actionMenu = undefined)}
    items={[
      { label: "复制", action: duplicate },
      { label: "上移", action: () => move(-1), disabled: index === 0 },
      { label: "下移", action: () => move(1), disabled: index === total - 1 },
      { label: "删除", action: () => void requestRemove(), danger: true, separatorBefore: true },
    ]}
  />
{/if}
