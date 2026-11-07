<script setup>
import { computed } from 'vue';
import { Eye, EyeOff, Minus, Plus } from 'lucide-vue-next';
import { useEditorPropertyList } from '@open-pencil/vue/controls/property-list';
import { useEffectsControls } from '@open-pencil/vue/controls/effects';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import ColorPicker from '../ui/ColorPicker.vue';
import NumberField from '../ui/NumberField.vue';
import { t } from '../l10n.js';

const { panels } = useI18n();
const list = useEditorPropertyList('effects');
const fx = useEffectsControls();
const types = computed(() => [
  { value: 'DROP_SHADOW', label: panels.value.dropShadow }, { value: 'INNER_SHADOW', label: panels.value.innerShadow },
  { value: 'LAYER_BLUR', label: panels.value.layerBlur }, { value: 'BACKGROUND_BLUR', label: panels.value.backgroundBlur },
]);
const scrub = (i, changes) => fx.scrubEffect(i, changes);
const commit = (i, changes) => fx.commitEffect(i, changes);
</script>

<template>
  <PanelSection v-if="list.active.value" :label="panels.effects" :empty="!list.isMixed.value && list.items.value.length === 0">
    <template #actions><IconButton :label="panels.addEffect" @click="list.actions.add(fx.createDefaultEffect())"><Plus /></IconButton></template>
    <div v-for="(effect, index) in list.items.value" :key="`${index}:${effect.visible}`" style="margin-top: 0.25rem">
      <div class="op-paint" :data-hidden="!effect.visible || undefined" style="margin: 0">
        <select class="op-select grow" style="flex: 1" :value="effect.type" @change="fx.updateType(list.actions.patch, list.activeNode.value, index, $event.target.value)">
          <option v-for="o in types" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <IconButton :label="panels.toggleVisibility" @click="list.actions.toggleVisibility(index)"><Eye v-if="effect.visible" /><EyeOff v-else /></IconButton>
        <IconButton :label="panels.removeEffect" @click="list.actions.remove(index)"><Minus /></IconButton>
      </div>
      <div class="op-grid2" style="margin-top: 0.25rem">
        <template v-if="fx.isShadow(effect.type)">
          <NumberField icon="X" :model-value="effect.offset.x" @update:model-value="scrub(index, { offset: { ...effect.offset, x: $event } })" @commit="(v) => commit(index, { offset: { ...effect.offset, x: v } })" />
          <NumberField icon="Y" :model-value="effect.offset.y" @update:model-value="scrub(index, { offset: { ...effect.offset, y: $event } })" @commit="(v) => commit(index, { offset: { ...effect.offset, y: v } })" />
        </template>
        <NumberField :label="t('模糊', 'Blur')" :model-value="effect.radius" :min="0" @update:model-value="scrub(index, { radius: $event })" @commit="(v) => commit(index, { radius: v })">
          <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7" stroke-dasharray="2 3" /></svg></template>
        </NumberField>
        <template v-if="fx.isShadow(effect.type)">
          <NumberField :label="panels.spread" :model-value="effect.spread" @update:model-value="scrub(index, { spread: $event })" @commit="(v) => commit(index, { spread: v })">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" /><rect x="3" y="3" width="18" height="18" stroke-dasharray="2 3" /></svg></template>
          </NumberField>
          <div class="op-paint-field" style="grid-column: span 2">
            <ColorPicker :color="effect.color" :label="panels.effectColor" @update="(c) => list.actions.patch(index, { color: c })" @open-change="(open) => !open && list.flush()" />
            <span style="font-size: var(--text-2xs)">{{ panels.effectColor }}</span>
          </div>
        </template>
      </div>
    </div>
  </PanelSection>
</template>
