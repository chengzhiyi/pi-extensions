<script setup>
// Styled wrapper over the SDK's headless NumberField (scrub to change, click to type, expressions).
import { NumberFieldRoot, NumberFieldInput, NumberFieldValue } from '@open-pencil/vue/primitives/NumberField';
defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: [Number, Symbol], required: true },
  min: Number, max: Number, step: Number, sensitivity: Number,
  icon: String, suffix: String, label: String, disabled: Boolean,
});
const emit = defineEmits(['update:modelValue', 'commit', 'cancel']);
</script>

<template>
  <NumberFieldRoot
    v-slot="{ editing, actions, attrs: rootAttrs, placeholder }"
    :model-value="props.modelValue" :min="props.min" :max="props.max" :step="props.step" :sensitivity="props.sensitivity"
    :aria-label="props.label ?? props.icon" :disabled="props.disabled" placeholder="Mixed"
    @update:model-value="(v) => emit('update:modelValue', v)"
    @commit="(v, p) => emit('commit', v, p)"
    @cancel="emit('cancel')"
  >
    <div
      v-bind="{ ...$attrs, ...rootAttrs }" class="op-num" :title="props.label"
      @pointerdown="!editing && !$event.target?.closest?.('button') && actions.startScrub($event)"
    >
      <span class="op-num-lead"><slot name="icon">{{ props.icon }}</slot></span>
      <NumberFieldInput />
      <NumberFieldValue class="value">
        <template #default="display">
          <span v-if="display.isMixed" class="mixed">{{ placeholder }}</span>
          <template v-else>{{ display.value }}<span v-if="props.suffix" class="suffix">{{ props.suffix }}</span></template>
        </template>
      </NumberFieldValue>
    </div>
  </NumberFieldRoot>
</template>
