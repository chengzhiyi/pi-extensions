<script setup>
// The agent's side of the editor: its recent changes (already on the canvas; the latest one can be
// undone), what it may touch (lock layers, limit it to the selection), and the last result.
// Proposals stored by older builds still show here with Accept / Reject.
import { Check, Lock, LockOpen, Maximize, ScanLine, Undo2, X } from 'lucide-vue-next';
import { t } from './l10n.js';
defineProps({ ui: { type: Object, required: true } });
const emit = defineEmits(['decide', 'lock', 'scope', 'unscope', 'undo']);
const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
</script>

<template>
  <div class="op-panel-body scroll" data-testid="review">
    <div class="op-review">
      <p v-if="!ui.docId" class="muted">{{ t('还没有设计。在画布上绘制即可开始，或在对话中让 Agent 设计一个。', 'No design yet. Draw on the canvas to start one, or ask the agent in the chat to design something.') }}</p>
      <p v-else-if="!ui.changes.length && !ui.proposals.length" class="muted">{{ t('Agent 的修改会直接出现在画布上，并列在这里。', 'The agent’s changes appear on the canvas directly and are listed here.') }}</p>
      <article v-for="proposal in ui.proposals" :key="proposal.id" class="op-proposal" :data-proposal="proposal.id">
        <div class="op-proposal-title">{{ proposal.title }}</div>
        <div class="muted" style="font-size: var(--text-2xs)">{{ t(`旧版提案 · ${proposal.opCount} 处修改 · 基于 rev ${proposal.baseRev}`, `Older proposal · ${proposal.opCount} changes · based on rev ${proposal.baseRev}`) }}</div>
        <img v-for="(img, i) in proposal.preview" :key="i" :src="`data:image/png;base64,${img}`" :alt="t('提案预览', 'Proposal preview')" />
        <div class="actions">
          <button class="btn primary" data-testid="accept" :disabled="ui.working" @click="emit('decide', proposal, 'accept')"><Check />{{ t('接受', 'Accept') }}</button>
          <button class="btn" data-testid="reject" :disabled="ui.working" @click="emit('decide', proposal, 'reject')"><X />{{ t('拒绝', 'Reject') }}</button>
        </div>
      </article>
      <ul v-if="ui.changes.length" class="op-changes" data-testid="changes">
        <li v-for="change in ui.changes" :key="change.rev" :data-reverted="change.reverted || undefined">
          <div class="grow">
            <div class="op-proposal-title truncate">{{ change.title }}</div>
            <div class="muted" style="font-size: var(--text-2xs)">rev {{ change.rev }} · {{ t(`${change.ops} 处修改`, `${change.ops} changes`) }}{{ change.at ? ` · ${time(change.at)}` : '' }}{{ change.reverted ? t(' · 已撤销', ' · undone') : '' }}</div>
          </div>
          <button v-if="change.undoable" class="btn" data-testid="undo" :disabled="ui.working" @click="emit('undo')"><Undo2 />{{ t('撤销', 'Undo') }}</button>
        </li>
      </ul>
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
        <div class="op-grid2">
          <button class="btn" data-testid="scope" :disabled="ui.working" @click="emit('scope')"><ScanLine />{{ t('仅限所选图层', 'Only the selection') }}</button>
          <button class="btn" data-testid="unscope" :disabled="ui.working" @click="emit('unscope')"><Maximize />{{ t('取消限制', 'Whole design') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>
