<script lang="ts">
  import { GENERATOR_TEMPLATES, type GeneratorTemplateId } from "../../../generator/visualRules";

  interface Props {
    apply: (template: GeneratorTemplateId) => void;
  }

  let { apply }: Props = $props();
</script>

<select class="template-menu" aria-label="常用模板" value="" onchange={(event) => { if (event.currentTarget.value) { apply(event.currentTarget.value as GeneratorTemplateId); event.currentTarget.value = ""; } }}>
  <option value="">常用模板…</option>
  {#each GENERATOR_TEMPLATES as template}<option value={template.id}>{template.label}</option>{/each}
</select>
