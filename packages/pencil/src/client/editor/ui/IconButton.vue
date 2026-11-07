<script setup>
defineProps({ label: String, active: Boolean, disabled: Boolean });
</script>

<template>
  <button type="button" class="icon-btn" :title="label" :aria-label="label" :disabled="disabled" :data-active="active || undefined"><slot /></button>
</template>
