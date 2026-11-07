<script setup>
import { computed } from 'vue';
import { colorToHexRaw, parseColor } from '@open-pencil/scene-graph/color';
import { useEditor } from '@open-pencil/vue';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import ColorPicker from '../ui/ColorPicker.vue';

const editor = useEditor();
const { panels } = useI18n();
const color = computed(() => editor.state.pageColor);
function setHex(event) {
  const raw = event.target.value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) editor.setPageColor({ ...parseColor(`#${raw}`), a: color.value.a });
  else event.target.value = colorToHexRaw(color.value);
}
function setAlpha(event) {
  const v = parseFloat(event.target.value);
  if (Number.isFinite(v)) editor.setPageColor({ ...color.value, a: Math.min(100, Math.max(0, v)) / 100 });
}
</script>

<template>
  <PanelSection :label="panels.page">
    <div class="op-paint" style="margin: 0">
      <div class="op-paint-field">
        <ColorPicker :color="color" :label="panels.pageBackground" @update="editor.setPageColor($event)" />
        <input class="op-hex" :value="colorToHexRaw(color)" :aria-label="panels.pageBackground" @change="setHex" @keydown.enter="$event.target.blur()" @keydown.stop />
        <input class="op-alpha" :value="Math.round(color.a * 100) + '%'" :aria-label="panels.opacity" @change="setAlpha" @keydown.enter="$event.target.blur()" @keydown.stop />
      </div>
    </div>
  </PanelSection>
</template>
