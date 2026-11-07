<script setup>
// options: [{ value, label, icon? }]
defineProps({ modelValue: null, options: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <div class="op-segment" role="radiogroup">
    <button
      v-for="o in options" :key="o.value" type="button" role="radio" :title="o.label" :aria-label="o.label"
      :aria-checked="modelValue === o.value" :data-active="modelValue === o.value || undefined" @click="emit('update:modelValue', o.value)"
    >
      <component :is="o.icon" v-if="o.icon" /><span v-else style="font-size: var(--text-2xs)">{{ o.label }}</span>
    </button>
  </div>
</template>
