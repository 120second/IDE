<script lang="ts">
  import { untrack } from "svelte";
  import { constant } from "../../../generator/visualRules";
  import { expressionIssue, expressionText, parseValueExpression } from "../../../generator/valueExpression";
  import type { ValueExpression } from "../../../types/generator";

  interface Props {
    value: ValueExpression;
    variables: string[];
    label: string;
    change: (value: ValueExpression) => void;
  }

  let { value, variables, label, change }: Props = $props();
  const id = $props.id();
  let draft = $state(untrack(() => expressionText(value)));
  let emitted: ValueExpression | undefined;
  let parsed = $derived(parseValueExpression(draft));
  let missingVariable = $derived(parsed ? Boolean(expressionIssue(parsed, variables)) : false);
  let invalid = $derived(!parsed || missingVariable);

  $effect(() => { if (value !== emitted) draft = expressionText(value); });

  function input(text: string): void {
    draft = text;
    emitted = parseValueExpression(text) ?? constant(text);
    change(emitted);
  }
</script>

<label class:invalid class="expression-input direct-expression">
  <span>{label}</span>
  <input aria-label={label} aria-invalid={invalid} title="支持 3n、3*n、n*m、(n+1)/2；除法取整。也支持整数、1e9、10^9。" list={`${id}-variables`} value={draft} placeholder={variables.length ? `如 ${variables[0]}、3${variables[0]}、${variables[0]}-1` : "整数，如 1e9"} spellcheck="false" autocomplete="off" oninput={(event) => input(event.currentTarget.value)} />
  {#if variables.length}<datalist id={`${id}-variables`}>{#each variables as name}<option value={name}></option><option value={`3${name}`}></option><option value={`${name}-1`}></option>{/each}</datalist>{/if}
</label>
