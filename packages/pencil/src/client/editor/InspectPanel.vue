<script setup>
// Inspect tab (OpenPencil's design check): its recommended rules (contrast, touch targets, text
// size, spacing scale…) over the page or the selection. Click a finding to select that layer.
import { computed, onUnmounted, ref, watch } from 'vue';
import { CircleCheck, CircleX, Lightbulb, TriangleAlert } from 'lucide-vue-next';
import { useEditor } from '@open-pencil/vue';
import { useDesignCheckMessages } from '@open-pencil/vue/i18n';
import { createLinter } from '@open-pencil/core/lint';
import Segmented from './ui/Segmented.vue';
import { t } from './l10n.js';

const props = defineProps({ active: Boolean });
const editor = useEditor();
const messages = useDesignCheckMessages();
const scope = ref('page');
const result = ref({ messages: [], errorCount: 0, warningCount: 0, infoCount: 0 });
const linter = createLinter({ preset: 'recommended' });
let timer;

function check() {
  const ids = scope.value === 'selection' ? [...editor.state.selectedIds] : [editor.state.currentPageId];
  result.value = ids.length ? linter.lintGraph(editor.graph, ids) : { messages: [], errorCount: 0, warningCount: 0, infoCount: 0 };
}
watch(() => [props.active, scope.value, editor.state.sceneVersion, editor.state.selectedIds, editor.state.currentPageId], () => {
  if (!props.active) return;
  clearTimeout(timer); timer = setTimeout(check, 200);
}, { immediate: true });
onUnmounted(() => clearTimeout(timer));

const pascal = (id) => id.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
const ruleTitle = (id) => messages.value[`rule${pascal(id)}`] ?? id;
const groups = computed(() => {
  const byRule = new Map();
  for (const m of result.value.messages) {
    const key = `${m.severity}:${m.ruleId}`;
    if (!byRule.has(key)) byRule.set(key, { key, severity: m.severity, ruleId: m.ruleId, items: [] });
    byRule.get(key).items.push(m);
  }
  const order = { error: 0, warning: 1, info: 2 };
  return [...byRule.values()].sort((a, b) => order[a.severity] - order[b.severity]);
});
const icon = { error: CircleX, warning: TriangleAlert, info: Lightbulb };
function reveal(m) { editor.select([m.nodeId]); editor.zoomToSelection(); }
</script>

<template>
  <div class="op-panel-body scroll" data-testid="inspect-panel">
    <div style="margin: 0.5rem 0.75rem"><Segmented v-model="scope" :options="[{ value: 'page', label: messages.scopePage }, { value: 'selection', label: messages.scopeSelection }]" /></div>
    <div class="op-lint-counts">
      <span class="sev-error"><CircleX />{{ result.errorCount }}</span>
      <span class="sev-warning"><TriangleAlert />{{ result.warningCount }}</span>
      <span class="sev-info"><Lightbulb />{{ result.infoCount }}</span>
    </div>
    <div v-if="!groups.length" class="op-lint-empty">
      <CircleCheck />
      <strong>{{ scope === 'selection' && !editor.state.selectedIds.size ? messages.noSelection : scope === 'selection' ? messages.emptySelection : messages.emptyPage }}</strong>
      <span class="muted">{{ t('已使用推荐规则检查。', 'Checked with the recommended rules.') }}</span>
    </div>
    <section v-for="g in groups" :key="g.key" class="op-lint-group">
      <div class="op-lint-rule" :class="`sev-${g.severity}`"><component :is="icon[g.severity]" />{{ ruleTitle(g.ruleId) }}<span class="muted">{{ g.items.length }}</span></div>
      <button v-for="(m, i) in g.items.slice(0, 50)" :key="i" type="button" class="op-row op-lint-item" data-testid="lint-item" :title="m.message" @click="reveal(m)">
        <span class="op-layer-name">{{ m.nodeName }}</span><span class="muted truncate" style="max-width: 55%">{{ m.message }}</span>
      </button>
    </section>
  </div>
</template>
