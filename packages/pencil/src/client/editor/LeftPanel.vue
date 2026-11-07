<script setup>
// Left sidebar: brand + document name (double-click to rename, chevron to switch designs),
// the menu bar, then Pages and Layers, as in OpenPencil.
import { nextTick, ref } from 'vue';
import { Check, ChevronDown, Plus } from 'lucide-vue-next';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui';
import { useI18n } from '@open-pencil/vue/i18n';
import MenuBar from './MenuBar.vue';
import PagesPanel from './PagesPanel.vue';
import LayersPanel from './LayersPanel.vue';
import { t } from './l10n.js';

const props = defineProps({ ui: { type: Object, required: true }, fileItems: Array, hosted: Boolean });
const emit = defineEmits(['rename', 'switch', 'new']);
const { panels } = useI18n();
const renaming = ref(false);
async function startRename() { if (!props.ui.docId) return; renaming.value = true; await nextTick(); const el = document.querySelector('[data-doc-rename]'); el?.focus(); el?.select(); }
function commit(e) { const v = e.target.value.trim(); renaming.value = false; if (v && v !== props.ui.title) emit('rename', v); }
</script>

<template>
  <aside class="op-left" data-testid="left-panel">
    <div class="op-header">
      <span class="op-logo" aria-hidden="true">P</span>
      <input v-if="renaming" data-doc-rename class="op-docname-input" :value="ui.title" @blur="commit" @keydown.stop="(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') renaming = false; }" />
      <span v-else class="op-docname truncate" data-testid="doc-name" :title="t('双击重命名', 'Double-click to rename')" @dblclick="startRename">{{ ui.title || panels.untitled || 'Untitled' }}</span>
      <DropdownMenuRoot v-if="hosted" :modal="false">
        <DropdownMenuTrigger class="icon-btn" :aria-label="t('切换设计', 'Switch design')" data-testid="designs"><ChevronDown /></DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="op-menu" :side-offset="4" align="end">
            <DropdownMenuLabel class="op-menu-label">{{ t('工作区中的设计', 'Designs in this workspace') }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="d in ui.docs" :key="d.docId" class="op-menu-item" @select="emit('switch', d.docId)">
              <Check :style="{ visibility: d.docId === ui.docId ? 'visible' : 'hidden' }" /><span class="label truncate">{{ d.title }}</span>
              <span v-if="d.pending" class="shortcut">{{ d.pending }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="ui.docs.length" class="op-menu-sep" />
            <DropdownMenuItem class="op-menu-item" data-testid="new-design" @select="emit('new')"><Plus /><span class="label">{{ t('新建设计', 'New design') }}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
    <MenuBar :file-items="fileItems" />
    <PagesPanel />
    <div class="op-layers">
      <div class="op-section-header"><span>{{ panels.layers }}</span></div>
      <LayersPanel />
    </div>
  </aside>
</template>
