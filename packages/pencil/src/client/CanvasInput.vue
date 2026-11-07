<script setup>
// Wires pointer/wheel editing, in-canvas text editing and the tool cursor onto the SDK canvas
// (OpenPencil's EditorCanvas pattern).
import { computed, onUnmounted, watchEffect } from 'vue';
import { useEditor } from '@open-pencil/vue';
import { useCanvasContext, useCanvasInput } from '@open-pencil/vue/canvas';
import { useTextEdit } from '@open-pencil/vue/canvas/text-edit';
import { toolCursor } from '@open-pencil/vue/editor/tool-cursor';
import { useEditorKeyboard } from './editor/keyboard.js';
import { host } from './host.js';
const editor = useEditor();
const ctx = useCanvasContext();
const { cleanupInteractions, cursorOverride } = useCanvasInput(ctx.canvasRef, editor, ctx.hitTestSectionTitle, ctx.hitTestComponentLabel, ctx.hitTestFrameTitle);
useTextEdit(ctx.canvasRef, editor);
useEditorKeyboard(editor, { enabled: () => !host.frozen });
const cursor = computed(() => toolCursor(editor.state.activeTool, cursorOverride?.value));
watchEffect(() => { if (ctx.canvasRef.value) ctx.canvasRef.value.style.cursor = cursor.value ?? ''; });
onUnmounted(cleanupInteractions);
</script>
<template><span hidden /></template>
