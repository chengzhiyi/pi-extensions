<script setup>
import { Eye, EyeOff } from 'lucide-vue-next';
import { AppearanceControlsRoot } from '@open-pencil/vue/primitives/AppearanceControls';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import NumberField from '../ui/NumberField.vue';
const { panels } = useI18n();
</script>

<template>
  <AppearanceControlsRoot v-slot="{ active, hasCornerRadius, cornerRadiusDisabled, cornerRadiusValue, hasPointCount, pointCount, opacityPercent, visibilityState, actions }">
    <PanelSection v-if="active" :label="panels.appearance">
      <template #actions>
        <IconButton :label="panels.toggleVisibility" @click="actions.toggleVisibility()"><EyeOff v-if="visibilityState === 'hidden'" /><Eye v-else /></IconButton>
      </template>
      <div class="op-grid2">
        <NumberField suffix="%" :label="panels.opacity" :model-value="opacityPercent" :min="0" :max="100"
          @update:model-value="actions.updateProp('opacity', $event / 100)" @commit="(v, p) => actions.commitProp('opacity', v / 100, p / 100)">
          <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg></template>
        </NumberField>
        <NumberField v-if="hasCornerRadius" :label="panels.radius" :model-value="cornerRadiusValue" :min="0" :disabled="cornerRadiusDisabled"
          @update:model-value="actions.updateUniformRadius" @commit="actions.commitUniformRadius">
          <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10a6 6 0 0 1 6-6h10" /></svg></template>
        </NumberField>
        <NumberField v-if="hasPointCount" icon="#" :label="panels.pointCount" :model-value="pointCount" :min="3" :max="60"
          @update:model-value="actions.updateProp('pointCount', Math.round($event))" @commit="(v, p) => actions.commitProp('pointCount', Math.round(v), p)" />
      </div>
    </PanelSection>
  </AppearanceControlsRoot>
</template>
