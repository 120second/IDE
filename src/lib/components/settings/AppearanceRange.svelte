<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue: number;
    unit?: "percent" | "px" | "position";
    disabled?: boolean;
    change: (value: number) => void;
  }
  let { label, value, min, max, step = 0.01, defaultValue, unit = "percent", disabled = false, change }: Props = $props();
  let display = $derived(unit === "percent" ? `${Math.round(value * 100)}%` : unit === "position" ? `${Math.round(value)}%` : `${Math.round(value)} px`);
</script>

<div class="appearance-range-control">
  <label class="appearance-range">
    <span class="range-heading"><span>{label}</span><output>{display}</output></span>
    <input type="range" aria-label={label} {min} {max} {step} {value} {disabled} oninput={(event) => change(Number(event.currentTarget.value))} />
  </label>
  <button type="button" class="range-reset" title={`恢复${label}默认值`} aria-label={`恢复${label}默认值`} disabled={disabled || value === defaultValue} onclick={() => change(defaultValue)}>重置</button>
</div>
