<script setup>
import { computed } from 'vue';
import { ArrowDown, ArrowRight, LayoutPanelTop, Link2, Unlink2 } from 'lucide-vue-next';
import { LAYOUT_CONTAINER_TYPES } from '@open-pencil/vue/controls/selection-layout';
import { LayoutControlsRoot } from '@open-pencil/vue/primitives/LayoutControls';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import NumberField from '../ui/NumberField.vue';
import Segmented from '../ui/Segmented.vue';
import { t } from '../l10n.js';
const { panels } = useI18n();
const directions = computed(() => [
  { value: 'VERTICAL', label: panels.value.layoutVertical, icon: ArrowDown },
  { value: 'HORIZONTAL', label: panels.value.layoutHorizontal, icon: ArrowRight },
]);
const ALIGN = ['MIN', 'CENTER', 'MAX'];
// 3×3 alignment pad: rows are vertical position, columns horizontal; which is primary depends on direction.
function cell(node, r, c) {
  const vertical = node.layoutMode === 'VERTICAL';
  const primary = vertical ? ALIGN[r] : ALIGN[c], counter = vertical ? ALIGN[c] : ALIGN[r];
  const active = (node.primaryAxisAlign === primary || (node.primaryAxisAlign === 'SPACE_BETWEEN' && primary === 'MIN')) && node.counterAxisAlign === counter;
  return { primary, counter, active };
}
</script>

<template>
  <LayoutControlsRoot v-slot="ctx">
    <PanelSection v-if="ctx.node" :label="ctx.node.layoutMode === 'NONE' ? panels.layout : panels.autoLayout">
      <template v-if="LAYOUT_CONTAINER_TYPES.has(ctx.node.type)" #actions>
        <IconButton :label="ctx.node.layoutMode === 'NONE' ? panels.addAutoLayout : panels.removeAutoLayout" :active="ctx.node.layoutMode !== 'NONE'"
          @click="ctx.editor.setLayoutMode(ctx.node.id, ctx.node.layoutMode === 'NONE' ? 'VERTICAL' : 'NONE')"><LayoutPanelTop /></IconButton>
      </template>
      <template v-if="ctx.isFlex">
        <div class="op-grid2" style="align-items: start">
          <div class="op-stack">
            <Segmented :model-value="ctx.node.layoutMode" :options="directions" @update:model-value="ctx.editor.setLayoutMode(ctx.node.id, $event)" />
            <NumberField :label="panels.gap" :model-value="ctx.node.itemSpacing" :min="0"
              @update:model-value="ctx.actions.updateProp('itemSpacing', $event)" @commit="(v, p) => ctx.actions.commitProp('itemSpacing', v, p)" @cancel="ctx.actions.cancelPreview()">
              <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v16M20 4v16M10 12h4" /></svg></template>
            </NumberField>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 4px; border-radius: 0.3rem; background: var(--color-panel-field); height: 3.25rem" :title="panels.alignment">
            <template v-for="r in 3" :key="r">
              <button v-for="c in 3" :key="c" type="button" :aria-label="panels.alignment"
                style="display: grid; place-items: center; padding: 0; border: 0; background: transparent; cursor: pointer"
                @click="ctx.actions.setAlignment(cell(ctx.node, r - 1, c - 1).primary, cell(ctx.node, r - 1, c - 1).counter)">
                <span :style="{ width: cell(ctx.node, r - 1, c - 1).active ? '8px' : '3px', height: cell(ctx.node, r - 1, c - 1).active ? '8px' : '3px', borderRadius: '2px', background: cell(ctx.node, r - 1, c - 1).active ? 'var(--color-accent)' : 'var(--color-muted)' }" />
              </button>
            </template>
          </div>
        </div>
        <div class="op-field-label">{{ t('内边距', 'Padding') }}</div>
        <div class="op-grid2">
          <NumberField :label="t('水平内边距', 'Horizontal padding')" :model-value="ctx.node.paddingLeft" :min="0"
            @update:model-value="ctx.actions.setHorizontalPadding" @commit="ctx.actions.commitHorizontalPadding" @cancel="ctx.actions.cancelPreview()">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v16M20 4v16" /><rect x="9" y="8" width="6" height="8" rx="1" /></svg></template>
          </NumberField>
          <NumberField :label="t('垂直内边距', 'Vertical padding')" :model-value="ctx.node.paddingTop" :min="0"
            @update:model-value="ctx.actions.setVerticalPadding" @commit="ctx.actions.commitVerticalPadding" @cancel="ctx.actions.cancelPreview()">
            <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16M4 20h16" /><rect x="8" y="9" width="8" height="6" rx="1" /></svg></template>
          </NumberField>
        </div>
      </template>
      <div class="op-field-label">{{ panels.dimensions }}</div>
      <div class="op-grid2">
        <div class="op-stack">
          <NumberField icon="W" :label="panels.width" :model-value="ctx.node.width" :min="0"
            @update:model-value="ctx.actions.updateAxisSize('width', $event)" @commit="(v, p) => ctx.actions.commitAxisSize('width', v, p)" @cancel="ctx.actions.cancelPreview()" />
          <select v-if="ctx.widthSizingOptions.length > 1" class="op-select" :value="ctx.widthSizing" :aria-label="panels.width" @change="ctx.actions.setAxisSizing('width', $event.target.value)">
            <option v-for="o in ctx.widthSizingOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="op-stack">
          <div class="op-inline">
            <NumberField class="grow" icon="H" :label="panels.height" :model-value="ctx.node.height" :min="0"
              @update:model-value="ctx.actions.updateAxisSize('height', $event)" @commit="(v, p) => ctx.actions.commitAxisSize('height', v, p)" @cancel="ctx.actions.cancelPreview()" />
            <IconButton v-if="ctx.aspectRatioLockable" :label="panels.lockAspectRatio" :active="ctx.aspectRatioLocked" @click="ctx.actions.toggleAspectRatioLock()">
              <Link2 v-if="ctx.aspectRatioLocked" /><Unlink2 v-else />
            </IconButton>
          </div>
          <select v-if="ctx.heightSizingOptions.length > 1" class="op-select" :value="ctx.heightSizing" :aria-label="panels.height" @change="ctx.actions.setAxisSizing('height', $event.target.value)">
            <option v-for="o in ctx.heightSizingOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
      </div>
      <label v-if="LAYOUT_CONTAINER_TYPES.has(ctx.node.type)" class="op-inline" style="margin-top: 0.5rem; font-size: var(--text-2xs); cursor: pointer">
        <input type="checkbox" :checked="ctx.node.clipsContent" @change="ctx.editor.updateNodeWithUndo(ctx.node.id, { clipsContent: $event.target.checked }, 'Clip content')" />
        {{ panels.clipContent }}
      </label>
    </PanelSection>
  </LayoutControlsRoot>
</template>
