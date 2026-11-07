<script setup>
// Export (OpenPencil's ExportSection): per-layer export settings (scale × format) saved with the
// design, then one button exports every row for the selection, or the page when nothing is selected.
import { computed, ref } from 'vue';
import { Minus, Plus } from 'lucide-vue-next';
import { useEditor } from '@open-pencil/vue';
import { useExport } from '@open-pencil/vue/document/export';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import { EXPORT_FORMATS, exportTarget } from '../io.js';
import { t } from '../l10n.js';

const editor = useEditor();
const { panels } = useI18n();
const ex = useExport();
const formats = computed(() => ex.formatOptions.filter((o) => EXPORT_FORMATS.includes(o.value)));
const busy = ref(false), error = ref('');

async function run() {
  busy.value = true; error.value = '';
  try {
    for (const id of ex.targetIds.value) {
      const node = editor.graph.getNode(id);
      if (!node) continue;
      const target = ex.activeTarget.value === 'page' ? { scope: 'page', pageId: id } : { scope: 'node', nodeId: id };
      for (const setting of ex.activeSettings.value) await exportTarget(editor, target, node.name, setting);
    }
  } catch (e) { error.value = String(e?.message ?? e); } finally { busy.value = false; }
}
</script>

<template>
  <PanelSection :label="panels.export" :empty="ex.activeSettings.value.length === 0" data-testid="export-section">
    <template #actions><IconButton :label="panels.addExport" data-testid="export-add" @click="ex.addSetting()"><Plus /></IconButton></template>
    <div v-for="(setting, index) in ex.activeSettings.value" :key="index" class="op-paint" style="margin: 0.25rem 0 0">
      <select class="op-select" style="width: 4.5rem" :aria-label="panels.exportScale" :disabled="!ex.formatSupportsScale(setting.format)" :value="setting.scale" @change="ex.updateScale(index, Number($event.target.value))">
        <option v-for="s in ex.scales" :key="s" :value="s">{{ s }}x</option>
      </select>
      <select class="op-select" style="flex: 1" :aria-label="panels.exportFormat" data-testid="export-format" :value="setting.format" @change="ex.updateFormat(index, $event.target.value)">
        <option v-for="o in formats" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <IconButton :label="t('移除导出', 'Remove export')" @click="ex.removeSetting(index)"><Minus /></IconButton>
    </div>
    <button v-if="ex.activeSettings.value.length" class="btn" style="width: 100%; margin-top: 0.5rem; justify-content: center" data-testid="export-run" :disabled="busy" @click="run">
      {{ busy ? t('导出中…', 'Exporting…') : t(`导出 ${ex.activeName.value}`, `Export ${ex.activeName.value}`) }}
    </button>
    <p v-if="error" class="op-message" style="margin: 0.375rem 0 0">{{ error }}</p>
  </PanelSection>
</template>
