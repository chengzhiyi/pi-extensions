<script setup>
// Swatch + popover picker: saturation/brightness area, hue and alpha sliders, hex field.
// The SDK's ColorPickerRoot owns the popover; reka-ui draws the area and sliders.
import { computed } from 'vue';
import { ColorAreaArea, ColorAreaRoot, ColorAreaThumb, ColorSliderRoot, ColorSliderThumb, ColorSliderTrack } from 'reka-ui';
import { colorToCSS } from '@open-pencil/scene-graph/color';
import { useColorModel } from '@open-pencil/vue/controls/color-model';
import { ColorPickerRoot } from '@open-pencil/vue/primitives/ColorPicker';

const props = defineProps({ color: { type: Object, required: true }, label: String });
const emit = defineEmits(['update', 'openChange', 'cancel']);
const color = computed(() => props.color);
const model = useColorModel({ color, onUpdate: (next) => emit('update', next) });
const swatch = computed(() => colorToCSS(props.color));
function onHex(event) {
  const raw = event.target.value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) model.updateHex(raw); else event.target.value = model.hex.value;
}
</script>

<template>
  <ColorPickerRoot
    :color="props.color" :label="props.label" :ui="{ content: 'op-popover' }"
    @open-change="emit('openChange', $event)" @cancel="emit('cancel')"
  >
    <template #trigger>
      <button type="button" class="op-swatch" :aria-label="props.label" :title="props.label"><span :style="{ background: swatch }" /></button>
    </template>
    <template #default>
      <ColorAreaRoot
        v-slot="{ style }" :model-value="model.rekaColor.value" color-space="hsb" x-channel="saturation" y-channel="brightness"
        @update:color="model.updateFromReka"
      >
        <ColorAreaArea class="op-cp-area" :style="style"><ColorAreaThumb class="op-cp-thumb" /></ColorAreaArea>
      </ColorAreaRoot>
      <ColorSliderRoot class="op-cp-slider" :model-value="model.rekaColor.value" channel="hue" color-space="hsl" @update:color="model.updateFromReka">
        <ColorSliderTrack class="op-cp-track" />
        <ColorSliderThumb class="op-cp-sthumb" :style="{ background: colorToCSS(model.sliderPreview.value.hue) }" />
      </ColorSliderRoot>
      <ColorSliderRoot class="op-cp-slider" :model-value="model.rekaColor.value" channel="alpha" color-space="rgb" :step="0.01" @update:color="model.updateFromReka">
        <ColorSliderTrack class="op-cp-track alpha" />
        <ColorSliderThumb class="op-cp-sthumb" :style="{ background: swatch }" />
      </ColorSliderRoot>
      <div class="op-cp-row">
        <input class="op-input" style="flex: 1; font-family: ui-monospace, monospace; text-transform: uppercase" :value="model.hex.value" aria-label="Hex" @change="onHex" @keydown.enter="$event.target.blur()" @keydown.stop />
        <input class="op-input" style="width: 3.5rem" :value="Math.round(props.color.a * 100) + '%'" aria-label="Alpha"
          @change="(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) model.updateAlpha(Math.min(100, Math.max(0, v)) / 100); }" @keydown.enter="$event.target.blur()" @keydown.stop />
      </div>
    </template>
  </ColorPickerRoot>
</template>
