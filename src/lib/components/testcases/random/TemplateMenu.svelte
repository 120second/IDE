<script lang="ts">
  import { GENERATOR_TEMPLATES, type GeneratorTemplateId } from "../../../generator/visualRules";

  interface Props {
    apply: (template: GeneratorTemplateId) => void;
    label?: string;
  }

  let { apply, label = "更多模板…" }: Props = $props();
</script>

<select class="template-menu" aria-label={label} value="" onchange={(event) => { if (event.currentTarget.value) { apply(event.currentTarget.value as GeneratorTemplateId); event.currentTarget.value = ""; } }}>
  <option value="">{label}</option>
  {#each GENERATOR_TEMPLATES as template}<option value={template.id}>{template.label}</option>{/each}
</select>
