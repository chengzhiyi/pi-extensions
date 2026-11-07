<script setup>
// Text styles. Fonts are offline: Inter ships with OpenPencil, Noto Sans SC with pi-pencil.
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-vue-next';
import { FigmaAPI } from '@open-pencil/core/figma-api';
import { MIXED } from '@open-pencil/vue/controls/node-props';
import { useEditor } from '@open-pencil/vue';
import { TypographyControlsRoot } from '@open-pencil/vue/primitives/TypographyControls';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import NumberField from '../ui/NumberField.vue';
import Segmented from '../ui/Segmented.vue';
import { t } from '../l10n.js';

const editor = useEditor();
const fontLoader = { load: (family, style) => new FigmaAPI(editor.graph).loadFontAsync({ family, style }) };
const { panels } = useI18n();
const FAMILIES = ['Inter', 'Noto Sans SC'];
const families = (current) => (typeof current === 'string' && !FAMILIES.includes(current) ? [current, ...FAMILIES] : FAMILIES);
const picked = (v) => (v === MIXED ? '' : v);
const aligns = [
  { value: 'LEFT', label: 'Left', icon: AlignLeft }, { value: 'CENTER', label: 'Center', icon: AlignCenter },
  { value: 'RIGHT', label: 'Right', icon: AlignRight }, { value: 'JUSTIFIED', label: 'Justified', icon: AlignJustify },
];
// lineHeight is a TextLength or null (auto); letterSpacing a TextLength. The fields edit pixels/percent as stored.
const lengthValue = (v) => (v === MIXED ? MIXED : v == null ? 0 : typeof v === 'number' ? v : v.value);
const lineHeightOf = (merged) => { const v = merged('lineHeight'); return v === MIXED ? MIXED : v == null ? Math.round(lengthValue(merged('fontSize')) * 1.2) : lengthValue(v); };
const lengthUnit = (v, fallback) => (v && v !== MIXED && typeof v === 'object' ? v.unit : fallback);
</script>

<template>
  <TypographyControlsRoot v-slot="ctx" :font-loader="fontLoader">
    <PanelSection v-if="ctx.node.value" :label="panels.typography">
      <div class="op-stack">
        <select class="op-select" :value="picked(ctx.merged('fontFamily'))" :aria-label="panels.fontFamily" @change="ctx.actions.setFamily($event.target.value)">
          <option v-if="ctx.merged('fontFamily') === MIXED" value="" disabled>{{ t('混合', 'Mixed') }}</option>
          <option v-for="f in families(ctx.merged('fontFamily'))" :key="f" :value="f">{{ f }}</option>
        </select>
        <div class="op-grid2">
          <select class="op-select" :value="picked(ctx.faceName.value)" :aria-label="panels.fontWeight" @change="ctx.actions.setFace($event.target.value)">
            <option v-for="o in ctx.faces.value" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <NumberField :label="panels.fontSize" :model-value="ctx.merged('fontSize')" :min="1" :max="1000"
            @update:model-value="ctx.actions.updateProp('fontSize', $event)" @commit="(v, p) => ctx.actions.commitProp('fontSize', v, p)" @cancel="ctx.actions.cancelProp('fontSize')">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h10v2M9 5v14M14 13v-2h6v2M17 11v8" /></svg></template>
          </NumberField>
        </div>
        <div class="op-grid2">
          <NumberField :label="panels.lineHeight" :model-value="lineHeightOf(ctx.merged)" :min="0"
            @update:model-value="ctx.actions.updateProp('lineHeight', { value: $event, unit: lengthUnit(ctx.merged('lineHeight'), 'PIXELS') })"
            @commit="(v, p) => ctx.actions.commitProp('lineHeight', { value: v, unit: lengthUnit(ctx.merged('lineHeight'), 'PIXELS') }, p)" @cancel="ctx.actions.cancelProp('lineHeight')">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16M4 20h16M9 16l3-8 3 8M10 13h4" /></svg></template>
          </NumberField>
          <NumberField :label="panels.letterSpacing" :model-value="lengthValue(ctx.merged('letterSpacing'))" :suffix="lengthUnit(ctx.merged('letterSpacing'), 'PIXELS') === 'PERCENT' ? '%' : ''"
            @update:model-value="ctx.actions.updateProp('letterSpacing', { value: $event, unit: lengthUnit(ctx.merged('letterSpacing'), 'PIXELS') })"
            @commit="(v, p) => ctx.actions.commitProp('letterSpacing', { value: v, unit: lengthUnit(ctx.merged('letterSpacing'), 'PIXELS') }, p)" @cancel="ctx.actions.cancelProp('letterSpacing')">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v16M20 4v16M8 16l4-8 4 8M9.5 13h5" /></svg></template>
          </NumberField>
        </div>
        <Segmented :model-value="picked(ctx.merged('textAlignHorizontal'))" :options="aligns" @update:model-value="ctx.actions.align($event)" />
      </div>
    </PanelSection>
  </TypographyControlsRoot>
</template>
