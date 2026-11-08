<script setup>
// File → Open workspace file…: the host gives the plugin no directory listing, so the person types
// the .fig's path inside the workspace (the designs this workspace already knows are one click away).
import { nextTick, ref, watch } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { t } from './l10n.js';

const props = defineProps({ open: Boolean, working: Boolean, error: String });
const emit = defineEmits(['update:open', 'submit']);
const path = ref('designs/');
const input = ref(null);
watch(() => props.open, async (open) => { if (open) { await nextTick(); input.value?.focus(); input.value?.select(); } });
const submit = () => { const v = path.value.trim(); if (v && !props.working) emit('submit', v); };
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="op-dialog-overlay" />
      <DialogContent class="op-dialog" data-testid="open-dialog" @keydown.stop>
        <DialogTitle class="op-dialog-title">{{ t('打开工作区文件', 'Open workspace file') }}</DialogTitle>
        <DialogDescription class="op-dialog-desc">{{ t('输入工作区中 .fig 文件的路径。', 'Path of a .fig file in this workspace.') }}</DialogDescription>
        <form @submit.prevent="submit">
          <input ref="input" v-model="path" class="op-input op-dialog-input" data-testid="open-path" spellcheck="false" autocomplete="off" placeholder="designs/home.fig" />
          <p v-if="error" class="op-dialog-error" role="alert">{{ error }}</p>
          <div class="op-dialog-actions">
            <button type="button" class="btn" @click="emit('update:open', false)">{{ t('取消', 'Cancel') }}</button>
            <button type="submit" class="btn primary" data-testid="open-submit" :disabled="working || !path.trim().toLowerCase().endsWith('.fig')">{{ t('打开', 'Open') }}</button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
