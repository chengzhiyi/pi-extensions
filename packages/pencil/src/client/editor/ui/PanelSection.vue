<script setup>
defineProps({ label: String, empty: Boolean });
</script>

<template>
  <section class="op-psection" :data-empty="empty || undefined">
    <div class="op-psection-head">
      <span>{{ label }}</span>
      <span class="actions"><slot name="actions" /></span>
    </div>
    <slot />
  </section>
</template>
