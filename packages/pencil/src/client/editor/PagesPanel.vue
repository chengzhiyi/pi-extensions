<script setup>
import { nextTick, ref } from 'vue';
import { File, Plus, Trash2 } from 'lucide-vue-next';
import { PageListRoot } from '@open-pencil/vue/primitives/PageList';
import { useI18n } from '@open-pencil/vue/i18n';
import IconButton from './ui/IconButton.vue';

const { panels, pages: pageMessages } = useI18n();
const editingId = ref(null);
async function startRename(id) { editingId.value = id; await nextTick(); const el = document.querySelector('[data-page-rename]'); el?.focus(); el?.select(); }
function commit(actions, id, event) { const name = event.target.value.trim(); if (name) actions.rename(id, name); editingId.value = null; }
</script>

<template>
  <PageListRoot v-slot="{ pages, currentPageId, isDivider, actions }">
    <div class="op-pages" data-testid="pages">
      <div class="op-section-header">
        <span>{{ panels.pages }}</span>
        <IconButton :label="panels.addPage" data-testid="pages-add" @click="actions.add()"><Plus /></IconButton>
      </div>
      <div class="op-pages-body scroll">
        <template v-for="pg in pages" :key="pg.id">
          <div v-if="isDivider(pg)" style="height: 1px; margin: 0.375rem 0.5rem; background: var(--color-border)" />
          <div v-else class="op-row" :data-active="pg.id === currentPageId || undefined" data-testid="page-row" @click="actions.switch(pg.id)" @dblclick="startRename(pg.id)">
            <File />
            <input v-if="editingId === pg.id" data-page-rename class="op-row-input" :value="pg.name" :aria-label="pageMessages.pageNameLabel" @click.stop
              @keydown.stop="(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') editingId = null; }" @blur="commit(actions, pg.id, $event)" />
            <span v-else class="truncate" style="flex: 1">{{ pg.name }}</span>
            <IconButton v-if="pages.length > 1 && pg.id === currentPageId && editingId !== pg.id" :label="pageMessages.delete" @click.stop="actions.delete(pg.id)"><Trash2 /></IconButton>
          </div>
        </template>
      </div>
    </div>
  </PageListRoot>
</template>
