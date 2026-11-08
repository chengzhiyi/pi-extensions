<script setup>
// Preview ("play") mode, as OpenPencil's app runs it: the canvas itself becomes the preview. Editing
// chrome goes away, animated shader fills run, and every top-level layer holding an instance of a
// component with a behaviour (button, switch, slider, tabs…) runs as a live control over the canvas.
// Lives inside CanvasRoot for the canvas element; the pill offers Reset and Exit, Esc exits too.
import { computed } from 'vue';
import { Play, RotateCcw, X } from 'lucide-vue-next';
import { useEditor } from '@open-pencil/vue';
import { PlayIslands, useCanvasContext } from '@open-pencil/vue/canvas';
import { t } from './l10n.js';

const editor = useEditor();
const ctx = useCanvasContext();
const playing = computed(() => editor.state.canvasView?.id === 'play');
</script>

<template>
  <PlayIslands :view="editor.state" :canvas="ctx.canvasRef.value ?? null" />
  <div v-if="playing" class="op-play-bar" role="toolbar" :aria-label="t('预览', 'Preview')" data-testid="play-bar">
    <span class="op-play-state"><Play />{{ t('预览中', 'Previewing') }}</span>
    <button type="button" class="btn" data-testid="play-reset" :title="t('重置所有控件', 'Reset every control')" @click="editor.resetPlay()"><RotateCcw />{{ t('重置', 'Reset') }}</button>
    <button type="button" class="icon-btn" data-testid="play-exit" :aria-label="t('退出预览', 'Exit preview')" :title="t('退出预览 (Esc)', 'Exit preview (Esc)')" @click="editor.stopPlay()"><X /></button>
  </div>
</template>
