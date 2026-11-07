<script setup>
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, RotateCw, FlipHorizontal2, FlipVertical2, RotateCwSquare } from 'lucide-vue-next';
import { PositionControlsRoot } from '@open-pencil/vue/primitives/PositionControls';
import { useI18n } from '@open-pencil/vue/i18n';
import PanelSection from '../ui/PanelSection.vue';
import IconButton from '../ui/IconButton.vue';
import NumberField from '../ui/NumberField.vue';
const { panels } = useI18n();
</script>

<template>
  <PositionControlsRoot v-slot="{ active, xValue, yValue, rotationValue, rotates, actions }">
    <PanelSection v-if="active" :label="panels.position">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.375rem">
        <div class="op-inline">
          <IconButton :label="panels.alignLeft" @click="actions.align('horizontal', 'min')"><AlignStartVertical /></IconButton>
          <IconButton :label="panels.alignCenterHorizontally" @click="actions.align('horizontal', 'center')"><AlignCenterVertical /></IconButton>
          <IconButton :label="panels.alignRight" @click="actions.align('horizontal', 'max')"><AlignEndVertical /></IconButton>
        </div>
        <div class="op-inline">
          <IconButton :label="panels.alignTop" @click="actions.align('vertical', 'min')"><AlignStartHorizontal /></IconButton>
          <IconButton :label="panels.alignCenterVertically" @click="actions.align('vertical', 'center')"><AlignCenterHorizontal /></IconButton>
          <IconButton :label="panels.alignBottom" @click="actions.align('vertical', 'max')"><AlignEndHorizontal /></IconButton>
        </div>
      </div>
      <div class="op-grid2">
        <NumberField icon="X" data-property="x" :label="panels.xAxis" :model-value="xValue"
          @update:model-value="actions.updateProp('x', $event)" @commit="(v, p) => actions.commitProp('x', v, p)" @cancel="actions.cancelProp('x')" />
        <NumberField icon="Y" data-property="y" :label="panels.yAxis" :model-value="yValue"
          @update:model-value="actions.updateProp('y', $event)" @commit="(v, p) => actions.commitProp('y', v, p)" @cancel="actions.cancelProp('y')" />
      </div>
      <div v-if="rotates" class="op-grid2" style="margin-top: 0.375rem">
        <NumberField suffix="°" data-property="rotation" :label="panels.rotation" :model-value="rotationValue" :min="-360" :max="360"
          @update:model-value="actions.updateProp('rotation', $event)" @commit="(v, p) => actions.commitProp('rotation', v, p)" @cancel="actions.cancelProp('rotation')">
          <template #icon><RotateCw /></template>
        </NumberField>
        <div class="op-inline" style="justify-content: flex-end">
          <IconButton :label="panels.flipHorizontal" @click="actions.flip('horizontal')"><FlipHorizontal2 /></IconButton>
          <IconButton :label="panels.flipVertical" @click="actions.flip('vertical')"><FlipVertical2 /></IconButton>
          <IconButton :label="panels.rotate90" @click="actions.rotate(90)"><RotateCwSquare /></IconButton>
        </div>
      </div>
    </PanelSection>
  </PositionControlsRoot>
</template>
