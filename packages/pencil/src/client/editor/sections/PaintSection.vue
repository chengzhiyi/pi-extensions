<script setup>
// Fills or strokes of the selection, one row per paint (Figma/OpenPencil layout):
// swatch → picker, hex, opacity, visibility, remove. Strokes add weight and alignment.
import { computed } from 'vue';
import { Eye, EyeOff, Minus, Plus } from 'lucide-vue-next';
import { colorToHexRaw, parseColor } from '@open-pencil/scene-graph/color';
import { useFillControls } from '@open-pencil/vue/controls/fill';
import { useEditorPropertyList } from '@open-pencil/vue/controls/property-list';
import { useStrokeControls } from '@open-pencil/vue/controls/stroke';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import ColorPicker from '../ui/ColorPicker.vue';
import NumberField from '../ui/NumberField.vue';

const props = defineProps({ kind: { type: String, required: true } }); // 'fills' | 'strokes'
const { panels } = useI18n();
const list = useEditorPropertyList(props.kind);
const stroke = props.kind === 'strokes' ? useStrokeControls() : null;
const fill = props.kind === 'fills' ? useFillControls() : null;
const label = computed(() => props.kind === 'fills' ? panels.value.fill : panels.value.stroke);
const GRADIENT = { GRADIENT_LINEAR: 'Linear', GRADIENT_RADIAL: 'Radial', GRADIENT_ANGULAR: 'Angular', GRADIENT_DIAMOND: 'Diamond', IMAGE: 'Image' };

function add() { list.actions.add(props.kind === 'fills' ? { ...fill.defaultFill } : { ...stroke.defaultStroke }); }
function setHex(index, paint, event) {
  const raw = event.target.value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) { event.target.value = colorToHexRaw(paint.color); return; }
  list.actions.update(index, { ...paint, color: { ...parseColor(`#${raw}`), a: paint.color.a } }); list.flush();
}
function setOpacity(index, event) {
  const v = parseFloat(event.target.value);
  if (!Number.isFinite(v)) return;
  list.actions.patch(index, { opacity: Math.min(100, Math.max(0, v)) / 100 }); list.flush();
}
const strokeWeight = computed(() => list.items.value[0]?.weight ?? 1);
function setWeight(v) { list.items.value.forEach((_, i) => list.actions.patch(i, { weight: Math.max(0, v) })); }
</script>

<template>
  <PanelSection v-if="list.active.value" :label="label" :empty="!list.isMixed.value && list.items.value.length === 0">
    <template #actions>
      <IconButton :label="kind === 'fills' ? panels.addFill : panels.addStroke" @click="add"><Plus /></IconButton>
    </template>
    <p v-if="list.isMixed.value" class="muted" style="font-size: var(--text-2xs); margin: 0">{{ panels.mixedFillsHelp }}</p>
    <div v-for="(paint, index) in list.items.value" :key="`${index}:${paint.visible}`" class="op-paint" :data-hidden="!paint.visible || undefined">
      <div class="op-paint-field">
        <ColorPicker
          v-if="paint.type === 'SOLID'" :color="paint.color" :label="label"
          @update="(c) => list.actions.update(index, { ...paint, color: c })" @open-change="(open) => !open && list.flush()" @cancel="list.flush()"
        />
        <span v-else class="op-swatch" :title="paint.type" />
        <input v-if="paint.type === 'SOLID'" class="op-hex" :value="colorToHexRaw(paint.color)" :aria-label="label" @change="setHex(index, paint, $event)" @keydown.enter="$event.target.blur()" @keydown.stop />
        <span v-else class="grow truncate" style="flex: 1; font-size: var(--text-2xs)">{{ GRADIENT[paint.type] ?? paint.type }}</span>
        <input class="op-alpha" :value="Math.round((paint.opacity ?? 1) * 100) + '%'" :aria-label="panels.opacity" @change="setOpacity(index, $event)" @keydown.enter="$event.target.blur()" @keydown.stop />
      </div>
      <IconButton :label="panels.toggleVisibility" @click="list.actions.toggleVisibility(index)"><Eye v-if="paint.visible" /><EyeOff v-else /></IconButton>
      <IconButton :label="kind === 'fills' ? panels.removeFill : panels.removeStroke" @click="list.actions.remove(index)"><Minus /></IconButton>
    </div>
    <div v-if="kind === 'strokes' && list.items.value.length" class="op-grid2" style="margin-top: 0.375rem">
      <select class="op-select" :value="stroke.currentAlign()" :aria-label="panels.strokeWeight" @change="stroke.updateAlign($event.target.value)">
        <option v-for="o in stroke.alignOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <NumberField :model-value="strokeWeight" :min="0" :label="panels.strokeWeight" @update:model-value="setWeight" @commit="list.flush()">
        <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16" stroke-width="1" /><path d="M4 12h16" stroke-width="2" /><path d="M4 18h16" stroke-width="3.5" /></svg></template>
      </NumberField>
    </div>
  </PanelSection>
</template>
