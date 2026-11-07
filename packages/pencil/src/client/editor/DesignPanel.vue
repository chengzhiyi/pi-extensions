<script setup>
// The Design tab: page settings when nothing is selected, else the selection's sections in
// OpenPencil's order (position, layout, appearance, typography, fill, stroke, effects, export).
import { computed } from 'vue';
import { Layers3, SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide-vue-next';
import { useEditorCommands } from '@open-pencil/vue/editor/commands';
import { useSelectionState } from '@open-pencil/vue/editor/selection-state';
import { useI18n } from '@open-pencil/vue/i18n';
import { nodeIcon } from './icons.js';
import PageSection from './sections/PageSection.vue';
import PositionSection from './sections/PositionSection.vue';
import LayoutSection from './sections/LayoutSection.vue';
import AppearanceSection from './sections/AppearanceSection.vue';
import TypographySection from './sections/TypographySection.vue';
import PaintSection from './sections/PaintSection.vue';
import EffectsSection from './sections/EffectsSection.vue';
import ExportSection from './sections/ExportSection.vue';
import IconButton from './ui/IconButton.vue';

const { selectedNode: node, selectedCount: count } = useSelectionState();
const { panels } = useI18n();
const icon = computed(() => (node.value ? nodeIcon(node.value) : null));
// Boolean operations for a multi-selection, as in OpenPencil's panel header.
const { getCommand } = useEditorCommands();
const booleans = [
  ['selection.booleanUnion', SquaresUnite], ['selection.booleanSubtract', SquaresSubtract],
  ['selection.booleanIntersect', SquaresIntersect], ['selection.booleanExclude', SquaresExclude],
].map(([id, glyph]) => ({ id, glyph, command: getCommand(id) }));
</script>

<template>
  <div class="op-panel-body scroll" data-testid="design-panel">
    <template v-if="count === 0">
      <PageSection />
      <ExportSection />
    </template>
    <template v-else>
      <div class="op-panel-header">
        <template v-if="count > 1">
          <Layers3 /><span class="name">{{ panels.selectedCount({ count: String(count) }) }}</span>
          <span class="op-header-actions" data-testid="booleans">
            <IconButton v-for="b in booleans" :key="b.id" :label="b.command.label" :disabled="!b.command.enabled.value" @click="b.command.run()"><component :is="b.glyph" /></IconButton>
          </span>
        </template>
        <template v-else-if="node"><component :is="icon" /><span class="name">{{ node.name }}</span></template>
      </div>
      <PositionSection />
      <LayoutSection v-if="count === 1" />
      <AppearanceSection />
      <TypographySection />
      <PaintSection kind="fills" />
      <PaintSection kind="strokes" />
      <EffectsSection />
      <ExportSection />
    </template>
  </div>
</template>
