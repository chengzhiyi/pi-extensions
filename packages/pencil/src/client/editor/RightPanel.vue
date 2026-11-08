<script setup>
// Right sidebar: document actions on top, then OpenPencil's tabs (Design, Code, Inspect) with the
// agent's tab where the official app has its AI chat (pi-webapp's chat is the AI here), and the zoom.
// The agent's changes land on the canvas directly; its tab lists them and what it may touch.
import { computed, ref, watch } from 'vue';
import { Code, ExternalLink, ListChecks, Play, Save, Sparkles } from 'lucide-vue-next';
import { useEditor } from '@open-pencil/vue';
import { useEditorCommands } from '@open-pencil/vue/editor/commands';
import { useDesignCheckMessages, useI18n } from '@open-pencil/vue/i18n';
import DesignPanel from './DesignPanel.vue';
import ReviewPanel from './ReviewPanel.vue';
import CodePanel from './CodePanel.vue';
import InspectPanel from './InspectPanel.vue';
import IconButton from './ui/IconButton.vue';
import { t } from './l10n.js';
import { host } from '../host.js';

const props = defineProps({ ui: { type: Object, required: true }, canOpenTab: Boolean, hosted: Boolean });
const emit = defineEmits(['decide', 'lock', 'scope', 'unscope', 'save', 'open-tab', 'undo', 'present']);
const editor = useEditor();
const { runCommand } = useEditorCommands();
const { panels } = useI18n();
const check = useDesignCheckMessages();
const tab = ref('design');
const zoom = computed(() => `${Math.round((editor.state.zoom ?? 1) * 100)}%`);
// A proposal stored by an older build still needs a decision, so it brings the Agent tab forward.
watch(() => props.ui.proposals.length, (n, before) => { if (n > (before ?? 0)) tab.value = 'review'; });
defineExpose({ tab });
</script>

<template>
  <aside class="op-right">
    <div v-if="hosted" class="op-right-top">
      <span class="muted truncate" style="flex: 1; font-size: var(--text-2xs)" data-testid="doc-meta">
        <template v-if="ui.docId">rev {{ ui.rev }}{{ host.frozen ? t(' · 更新中…', ' · updating…') : host.dirty || host.busy ? t(' · 同步中…', ' · syncing…') : '' }}</template>
      </span>
      <button class="btn" data-testid="present" :title="t('预览：在画布上运行设计和其中的交互控件 (⌥⌘↩)', 'Preview: run the design and its interactive controls on the canvas (⌥⌘↩)')" @click="emit('present')"><Play />{{ t('预览', 'Preview') }}</button>
      <IconButton v-if="canOpenTab && ui.docId" data-testid="open-tab" :label="t('在新标签页中打开', 'Open in tab')" :disabled="ui.working" @click="emit('open-tab')"><ExternalLink /></IconButton>
      <button class="btn primary" data-testid="save" :disabled="ui.working || !ui.docId" :title="t('保存为工作区中的 .fig 文件', 'Save as a .fig file in the workspace')" @click="emit('save')"><Save />{{ t('保存', 'Save') }}</button>
    </div>
    <div class="op-ptabs" role="tablist">
      <button class="op-ptab" role="tab" data-testid="tab-design" :data-active="tab === 'design' || undefined" @click="tab = 'design'">{{ panels.design }}</button>
      <button class="op-ptab" role="tab" data-testid="tab-code" :data-active="tab === 'code' || undefined" @click="tab = 'code'"><Code />{{ panels.code }}</button>
      <button v-if="hosted" class="op-ptab" role="tab" data-testid="tab-review" :data-active="tab === 'review' || undefined" @click="tab = 'review'">
        <Sparkles />Agent<span v-if="ui.proposals.length" class="badge">{{ ui.proposals.length }}</span>
      </button>
      <button class="op-ptab" role="tab" data-testid="tab-inspect" :data-active="tab === 'inspect' || undefined" @click="tab = 'inspect'"><ListChecks />{{ check.tab }}</button>
      <button class="op-zoom" :title="t('缩放至适合', 'Zoom to fit')" @click="runCommand('view.zoomFit')">{{ zoom }}</button>
    </div>
    <DesignPanel v-show="tab === 'design'" />
    <CodePanel v-show="tab === 'code'" :active="tab === 'code'" />
    <InspectPanel v-show="tab === 'inspect'" :active="tab === 'inspect'" />
    <ReviewPanel v-if="hosted" v-show="tab === 'review'" :ui="ui" @decide="(p, v) => emit('decide', p, v)" @lock="emit('lock', $event)" @scope="emit('scope')" @unscope="emit('unscope')" @undo="emit('undo')" />
  </aside>
</template>
