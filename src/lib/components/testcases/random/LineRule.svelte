<script lang="ts">
  import {
    fieldDiagnostics,
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

  function updateField(index: number, field: VisualField): void {
    change({ ...node, fields: node.fields.map((candidate, candidateIndex) => candidateIndex === index ? field : candidate) });
  }

  function removeField(index: number): void {
    change({ ...node, fields: node.fields.filter((_, candidateIndex) => candidateIndex !== index) });
  }

  function addField(type: "integer" | "string" | "permutation"): void {
    const available = scopeAfterLineField(node.fields, node.fields.length, scope);
    const fallback = available.at(-1) ?? "n";
    const field: VisualField = type === "integer"
      ? integerField(suggestIntegerName(available))
      : type === "string"
        ? { type: "string", id: newRuleId("field"), name: "s", length: variable(fallback), alphabet: "lowercase" }
        : { type: "permutation", id: newRuleId("field"), name: "p", length: variable(fallback) };
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
  <div class="add-field-row">
    <span>同一行添加</span>
    <button type="button" onclick={() => addField("integer")}><Icon name="plus" size={12} />整数</button>
    <button type="button" onclick={() => addField("string")}>字符串</button>
    <button type="button" onclick={() => addField("permutation")}>排列</button>
  </div>
</div>
