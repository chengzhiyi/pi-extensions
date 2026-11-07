<script setup>
// Wires pointer/wheel/keyboard editing onto the SDK canvas (upstream EditorCanvas pattern).
import { onUnmounted } from 'vue';
import { useEditor } from '@open-pencil/vue';
import { useCanvasContext, useCanvasInput } from '@open-pencil/vue/canvas';
const editor = useEditor();
const ctx = useCanvasContext();
const { cleanupInteractions } = useCanvasInput(ctx.canvasRef, editor, ctx.hitTestSectionTitle, ctx.hitTestComponentLabel, ctx.hitTestFrameTitle);
onUnmounted(cleanupInteractions);
</script>
<template><span hidden /></template>
