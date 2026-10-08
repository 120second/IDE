<script lang="ts">
  import {
    fieldDiagnostics,
    arrayField,
    constant,
    integerField,
    newRuleId,
    scopeAfterLineField,
    suggestIntegerName,
    variable,
  } from "../../../generator/visualRules";
  import type { VisualDiagnostic, VisualField, VisualNode } from "../../../types/generator";
  import FieldEditor from "./FieldEditor.svelte";
  import Icon from "../../shell/Icon.svelte";

  interface Props {
    node: Extract<VisualNode, { type: "line" }>;
    scope: string[];
    diagnostics: VisualDiagnostic[];
    change: (node: VisualNode) => void;
  }

  let { node, scope, diagnostics, change }: Props = $props();
  let fieldNames = $state("");
  let nameError = $state("");

  function addNamedFields(): void {
    const names = fieldNames.trim().split(/[\s,，]+/).filter(Boolean);
    if (!names.length) return;
    const available = scopeAfterLineField(node.fields, node.fields.length, scope);
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) || new Set([...available, ...names]).size !== available.length + names.length) {
      nameError = "请使用未定义的变量名，多个名称用空格分隔。";
      return;
    }
    change({ ...node, fields: [...node.fields, ...names.map((name) => integerField(name))] });
    fieldNames = "";
    nameError = "";
  }

  function updateField(index: number, field: VisualField): void {
    change({ ...node, fields: node.fields.map((candidate, candidateIndex) => candidateIndex === index ? field : candidate) });
  }

  function removeField(index: number): void {
    change({ ...node, fields: node.fields.filter((_, candidateIndex) => candidateIndex !== index) });
  }

  function addField(type: "integer" | "array" | "string" | "permutation"): void {
    const available = scopeAfterLineField(node.fields, node.fields.length, scope);
    const fallback = available.includes("n") ? "n" : available.at(-1);
    const length = fallback ? variable(fallback) : constant(10);
    const field: VisualField = type === "integer"
      ? integerField(suggestIntegerName(available))
      : type === "array" ? arrayField("a", length)
      : type === "string"
        ? { type: "string", id: newRuleId("field"), name: "s", length, alphabet: "lowercase" }
        : { type: "permutation", id: newRuleId("field"), name: "p", length };
    change({ ...node, fields: [...node.fields, field] });
  }
</script>

<div class="line-fields">
  {#each node.fields as field, index (field.id)}
    <FieldEditor
      {field}
      variables={scopeAfterLineField(node.fields, index, scope)}
      diagnostics={fieldDiagnostics(diagnostics, field.id)}
      change={(updated) => updateField(index, updated)}
      remove={() => removeField(index)}
    />
  {/each}
  <details class="line-extra-fields line-field-tools">
  <summary><Icon name="plus" size={12} />同行添加更多字段</summary>
  <div class="add-field-row">
    <button type="button" onclick={() => addField("integer")}><Icon name="plus" size={12} />同行整数</button>
    <label class="named-fields"><input aria-label="同行批量添加整数变量" placeholder="如 x y z，按 Enter 添加" spellcheck="false" autocomplete="off" bind:value={fieldNames} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNamedFields(); } }} /></label>
    {#if fieldNames.trim()}<button type="button" onclick={addNamedFields}>添加</button>{/if}
  </div>
  {#if nameError}<p class="rule-error" role="alert">{nameError}</p>{/if}
  <div class="line-container-fields"><button type="button" onclick={() => addField("array")}>数组</button><button type="button" onclick={() => addField("string")}>字符串</button><button type="button" onclick={() => addField("permutation")}>排列</button></div>
  </details>
</div>
