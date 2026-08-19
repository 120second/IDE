<script lang="ts">
  import { constant, variable } from "../../../generator/visualRules";
  import type { ValueExpression } from "../../../types/generator";

  interface Props {
    value: ValueExpression;
    variables: string[];
    label: string;
    change: (value: ValueExpression) => void;
  }

  let { value, variables, label, change }: Props = $props();
  let selection = $derived(value.type === "constant" ? "constant" : `variable:${value.name}`);
  let missingVariable = $derived(value.type === "variable" && !variables.includes(value.name));

  function selectSource(event: Event): void {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    if (selected === "constant") {
      change(constant(value.type === "constant" ? value.value : "1"));
    } else {
      const name = selected.slice("variable:".length);
      change(variable(name, value.type === "variable" && value.name === name ? value.offset : 0));
    }
  }

  function setOffsetSign(event: Event): void {
    if (value.type !== "variable") return;
    const sign = Number((event.currentTarget as HTMLSelectElement).value);
    change(variable(value.name, sign === 0 ? 0 : sign * Math.max(1, Math.abs(value.offset))));
  }

  function setOffsetAmount(event: Event): void {
    if (value.type !== "variable") return;
    const amount = Math.max(0, Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || 0));
    change(variable(value.name, value.offset < 0 ? -amount : amount));
  }
</script>

<label class:invalid={missingVariable} class="expression-input">
  <span>{label}</span>
  <div>
    <select aria-label={`${label}来源`} value={selection} onchange={selectSource}>
      <option value="constant">常量</option>
      {#if missingVariable}<option value={`variable:${value.type === "variable" ? value.name : ""}`}>⚠ {value.type === "variable" ? value.name : "?"}（已失效）</option>{/if}
      {#each variables as name}<option value={`variable:${name}`}>{name}</option>{/each}
    </select>
    {#if value.type === "constant"}
      <input aria-label={`${label}常量`} value={value.value} oninput={(event) => change(constant(event.currentTarget.value))} />
    {:else}
      <select class="offset-sign" aria-label={`${label}偏移运算`} value={value.offset === 0 ? 0 : value.offset > 0 ? 1 : -1} onchange={setOffsetSign}>
        <option value={0}>无</option><option value={1}>+</option><option value={-1}>−</option>
      </select>
      {#if value.offset !== 0}<input class="offset-value" type="number" min="0" aria-label={`${label}偏移量`} value={Math.abs(value.offset)} oninput={setOffsetAmount} />{/if}
    {/if}
  </div>
</label>
