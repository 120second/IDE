<script lang="ts">
  import { STRATEGIES } from "../../../generator/visualRules";
  import type { GeneratorStrategy, VisualDiagnostic, VisualField } from "../../../types/generator";
  import ValueExpressionInput from "./ValueExpressionInput.svelte";
  import Icon from "../../shell/Icon.svelte";

  interface Props {
    field: VisualField;
    variables: string[];
    diagnostics: VisualDiagnostic[];
    change: (field: VisualField) => void;
    remove: () => void;
  }

  let { field, variables, diagnostics, change, remove }: Props = $props();

  function setName(name: string): void {
    change({ ...field, name } as VisualField);
  }
</script>

<div class:invalid={diagnostics.length > 0} class:scalar-field={field.type === "integer"} class="field-editor">
  {#if field.type !== "integer"}<header><strong>{field.type === "array" ? "数组" : field.type === "string" ? "字符串" : "排列"}</strong></header>{/if}
  <label class="field-name"><span>{field.type === "integer" ? "整数变量" : "名称"}</span><input aria-label={`${field.name || "未命名"}的变量名`} spellcheck="false" autocomplete="off" value={field.name} oninput={(event) => setName(event.currentTarget.value)} /></label>

  {#if field.type === "integer"}
    <div class="range-editor">
      <ValueExpressionInput label="范围下界" value={field.minimum} {variables} change={(minimum) => change({ ...field, minimum })} />
      <span>～</span>
      <ValueExpressionInput label="范围上界" value={field.maximum} {variables} change={(maximum) => change({ ...field, maximum })} />
    </div>
  {:else if field.type === "array"}
    <ValueExpressionInput label="数组长度" value={field.length} {variables} change={(length) => change({ ...field, length })} />
    <div class="range-editor">
      <ValueExpressionInput label="元素下界" value={field.minimum} {variables} change={(minimum) => change({ ...field, minimum })} />
      <span>～</span>
      <ValueExpressionInput label="元素上界" value={field.maximum} {variables} change={(maximum) => change({ ...field, maximum })} />
    </div>
    <label><span>数组分布</span><select value={field.strategy ?? ""} onchange={(event) => change({ ...field, strategy: event.currentTarget.value ? event.currentTarget.value as GeneratorStrategy : undefined })}><option value="">跟随生成设置</option>{#each STRATEGIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  {:else if field.type === "string"}
    <ValueExpressionInput label="字符串长度" value={field.length} {variables} change={(length) => change({ ...field, length })} />
    <label><span>字符集</span><select value={field.alphabet} onchange={(event) => change({ ...field, alphabet: event.currentTarget.value as "binary" | "lowercase" })}><option value="lowercase">小写字母</option><option value="binary">二进制</option></select></label>
  {:else}
    <ValueExpressionInput label="排列长度" value={field.length} {variables} change={(length) => change({ ...field, length })} />
  {/if}

  <button type="button" class="field-remove" title="删除字段" aria-label={`删除字段 ${field.name || "未命名"}`} onclick={remove}><Icon name="close" size={13} /></button>

  {#each diagnostics as diagnostic}<p class="rule-error">{diagnostic.message}</p>{/each}
</div>
