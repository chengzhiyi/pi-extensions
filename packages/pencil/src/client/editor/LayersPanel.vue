<script setup>
// Layers of the current page, from the SDK's LayerTree model (selection, expand, drag to reorder
// or nest, visibility, lock, double-click rename). Rows are plain DOM: pages here stay small.
import { nextTick, ref } from 'vue';
import { ChevronRight, Eye, EyeOff, Lock, LockOpen } from 'lucide-vue-next';
import { LayerTreeItem, LayerTreeRoot } from '@open-pencil/vue/primitives/LayerTree';
import { useI18n } from '@open-pencil/vue/i18n';
import IconButton from './ui/IconButton.vue';
import { isComponentType, nodeIcon } from './icons.js';
import { t } from './l10n.js';

const INDENT = 14;
const { panels } = useI18n();
const editingId = ref(null);
async function startRename(id) { editingId.value = id; await nextTick(); const el = document.querySelector('[data-rename-input]'); el?.focus(); el?.select(); }
function commitRename(actions, event) { const name = event.target.value.trim(); if (name) actions.rename(name); editingId.value = null; }
const drop = (scope, id) => (scope.instructionTargetId === id && scope.instruction ? { 'reorder-above': 'before', 'reorder-below': 'after', 'make-child': 'inside' }[scope.instruction.type] : undefined);
const mode = (e) => ({ additive: e.metaKey || e.ctrlKey, range: e.shiftKey });
</script>

<template>
  <LayerTreeRoot v-slot="scope" :indent-per-level="INDENT">
    <div class="op-layers-body scroll" data-testid="layers" tabindex="-1" @focusin="scope.actions.setFocused(true)" @focusout="scope.actions.setFocused(false)">
      <p v-if="!scope.visibleRows.length" class="op-empty">{{ t('暂无图层', 'No layers yet') }}</p>
      <LayerTreeItem v-for="row in scope.visibleRows" :key="row.node.id" v-slot="{ node, isSelected, actions }" :node="row.node" :level="row.level" :has-children="row.hasChildren">
        <div
          class="op-layer" :style="{ paddingLeft: `${(row.level - 1) * INDENT + 4}px` }" :data-selected="isSelected || undefined"
          :data-hidden="!node.visible || undefined" :data-component="isComponentType(node.type) || undefined" :data-drop="drop(scope, node.id)"
          data-testid="layer-row" :data-layer-name="node.name"
          @click="scope.actions.select(node.id, mode($event))" @dblclick="startRename(node.id)"
        >
          <button v-if="row.hasChildren" type="button" class="op-layer-chevron" :data-open="scope.expanded.includes(node.id) || undefined" @click.stop="actions.toggleExpand()"><ChevronRight /></button>
          <span v-else style="width: 1rem; flex: none" />
          <component :is="nodeIcon(node)" class="op-layer-icon" />
          <input v-if="editingId === node.id" data-rename-input class="op-row-input" :value="node.name" @click.stop
            @keydown.stop="(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') editingId = null; }" @blur="commitRename(actions, $event)" />
          <span v-else class="op-layer-name">{{ node.name }}</span>
          <span class="op-layer-actions" :data-pinned="(node.locked || !node.visible) || undefined">
            <IconButton :label="panels.toggleVisibility" @click.stop="actions.toggleVisibility()"><EyeOff v-if="!node.visible" /><Eye v-else /></IconButton>
            <IconButton :label="node.locked ? 'Unlock' : 'Lock'" @click.stop="actions.toggleLock()"><Lock v-if="node.locked" /><LockOpen v-else /></IconButton>
          </span>
        </div>
      </LayerTreeItem>
    </div>
  </LayerTreeRoot>
</template>
