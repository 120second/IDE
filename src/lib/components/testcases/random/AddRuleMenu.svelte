<script lang="ts">
  export type AddRuleKind = "integer" | "array" | "string" | "permutation" | "repeat" | "tree" | "graph" | "matrix";

  interface Props {
    depth: number;
    add: (kind: AddRuleKind) => void;
    compact?: boolean;
  }

  let { depth, add, compact = false }: Props = $props();
  let open = $state(false);

  function choose(kind: AddRuleKind): void {
    open = false;
    add(kind);
  }
</script>

<div class="add-rule-menu">
  <button class:compact class="secondary-button" onclick={() => (open = !open)}>＋ {compact ? "添加" : "添加规则"}</button>
  {#if open}
    <div class="add-rule-popover">
      <button onclick={() => choose("integer")}><strong>整数</strong><span>一个新的标量输入行</span></button>
      <button onclick={() => choose("array")}><strong>数组</strong><span>独占一行的整数数组</span></button>
      <button onclick={() => choose("string")}><strong>字符串</strong><span>二进制串或小写串</span></button>
      <button onclick={() => choose("permutation")}><strong>排列</strong><span>1 到 n 的随机排列</span></button>
      <button onclick={() => choose("repeat")} disabled={depth >= 4}><strong>重复块</strong><span>{depth >= 4 ? "已达到 4 层限制" : "按变量或常量重复"}</span></button>
      <button onclick={() => choose("tree")}><strong>树</strong><span>无权或带权树</span></button>
      <button onclick={() => choose("graph")}><strong>图</strong><span>简单图、连通图或有向无环图</span></button>
      <button onclick={() => choose("matrix")}><strong>矩阵</strong><span>多行定长整数</span></button>
    </div>
  {/if}
</div>
