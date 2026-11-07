<script setup>
// The agent's side of the editor: proposals waiting for review (Accept / Reject), what the agent
// may touch (lock layers, limit it to the selection), and the last result.
import { Check, Lock, LockOpen, ScanLine, X } from 'lucide-vue-next';
import { t } from './l10n.js';
defineProps({ ui: { type: Object, required: true } });
const emit = defineEmits(['decide', 'lock', 'scope']);
</script>

<template>
  <div class="op-panel-body scroll" data-testid="review">
    <div class="op-review">
      <p v-if="!ui.docId" class="muted">{{ t('还没有设计。在画布上绘制即可开始，或让 Agent 设计一个。', 'No design yet. Draw on the canvas to start one, or ask the agent to design something.') }}</p>
      <p v-else-if="!ui.proposals.length" class="muted">{{ t('没有待审阅的提案。', 'Nothing waiting for review.') }}</p>
      <article v-for="proposal in ui.proposals" :key="proposal.id" class="op-proposal" :data-proposal="proposal.id">
        <div class="op-proposal-title">{{ proposal.title }}</div>
        <div class="muted" style="font-size: var(--text-2xs)">{{ t(`${proposal.opCount} 处修改 · 基于 rev ${proposal.baseRev}`, `${proposal.opCount} changes · based on rev ${proposal.baseRev}`) }}</div>
        <img v-for="(img, i) in proposal.preview" :key="i" :src="`data:image/png;base64,${img}`" :alt="t('提案预览', 'Proposal preview')" />
        <div class="actions">
          <button class="btn primary" data-testid="accept" :disabled="ui.working" @click="emit('decide', proposal, 'accept')"><Check />{{ t('接受', 'Accept') }}</button>
          <button class="btn" data-testid="reject" :disabled="ui.working" @click="emit('decide', proposal, 'reject')"><X />{{ t('拒绝', 'Reject') }}</button>
        </div>
      </article>
      <p v-if="ui.message" class="op-message" data-testid="message">{{ ui.message }}</p>
      <ul v-if="ui.conflicts.length" class="op-conflicts" data-testid="conflicts">
        <li v-for="c in ui.conflicts" :key="c.index">{{ t('第', 'change ') }}{{ c.index + 1 }}{{ t(' 处修改：图层', ': layer') }} {{ c.reason }}{{ c.fields ? ` (${c.fields.slice(0, 3).join(', ')})` : '' }}</li>
      </ul>
    </div>
    <section v-if="ui.docId" class="op-psection" style="border-top: 1px solid var(--color-border)">
      <div class="op-psection-head"><span>{{ t('Agent 权限', 'Agent access') }}</span></div>
      <p class="muted" style="margin: 0 0 0.5rem; font-size: var(--text-2xs)">{{ t('先在画布或图层中选择图层。', 'Select layers on the canvas or in Layers first.') }}</p>
      <div class="op-stack">
        <div class="op-grid2">
          <button class="btn" data-testid="lock" :disabled="ui.working" @click="emit('lock', true)"><Lock />{{ t('锁定', 'Lock') }}</button>
          <button class="btn" data-testid="unlock" :disabled="ui.working" @click="emit('lock', false)"><LockOpen />{{ t('解锁', 'Unlock') }}</button>
        </div>
        <button class="btn" data-testid="scope" :disabled="ui.working" @click="emit('scope')"><ScanLine />{{ t('仅允许修改所选图层', 'Agent: only the selection') }}</button>
      </div>
    </section>
  </div>
</template>
