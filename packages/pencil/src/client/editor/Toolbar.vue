<script setup>
// Floating tool bar at the bottom of the canvas (OpenPencil's design toolbar): move, frame,
// shapes, pen, text, hand. Flyouts open from the caret beside a tool.
import { computed } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';
import { EDITOR_TOOLS } from '@open-pencil/core';
import { getToolbarToolSelection, isToolbarToolActive, ToolbarRoot } from '@open-pencil/vue/primitives/Toolbar';
import { useI18n } from '@open-pencil/vue/i18n';
import { toolIcons } from './icons.js';
import { hosted } from '../host.js';

const DESIGN = ['SELECT', 'FRAME', 'RECTANGLE', 'PEN', 'TEXT', 'HAND'];
const tools = EDITOR_TOOLS.filter((t) => DESIGN.includes(t.key));
const { tools: names } = useI18n();
const label = computed(() => ({
  SELECT: names.value.move, FRAME: names.value.frame, SECTION: names.value.section, RECTANGLE: names.value.rectangle,
  ELLIPSE: names.value.ellipse, LINE: names.value.line, POLYGON: names.value.polygon, STAR: names.value.star,
  PEN: names.value.pen, PENCIL: names.value.pencil, TEXT: names.value.text, HAND: names.value.hand,
}));
const SHORTCUT = { SELECT: 'V', FRAME: 'F', SECTION: '⇧S', RECTANGLE: 'R', ELLIPSE: 'O', LINE: 'L', PEN: 'P', PENCIL: '⇧P', TEXT: 'T', HAND: 'H' };
const tip = (key) => `${label.value[key] ?? key}${SHORTCUT[key] ? ` (${SHORTCUT[key]})` : ''}`;
</script>

<template>
  <div class="op-toolbar-wrap" data-canvas-obstacle>
    <ToolbarRoot v-slot="{ activeTool, flyoutSelections, actions }" :tools="tools">
      <div class="op-toolbar" role="toolbar" data-testid="toolbar">
        <template v-for="tool in tools" :key="tool.key">
          <div v-if="tool.flyout" class="op-tool-group">
            <button type="button" class="op-tool" :data-testid="`tool-${tool.key.toLowerCase()}`" :title="tip(getToolbarToolSelection(tool, activeTool, flyoutSelections))"
              :data-active="isToolbarToolActive(tool, activeTool) || undefined" @click="actions.setTool(getToolbarToolSelection(tool, activeTool, flyoutSelections))">
              <component :is="toolIcons[getToolbarToolSelection(tool, activeTool, flyoutSelections)]" />
            </button>
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger class="op-tool-caret" :aria-label="label[tool.key]"><ChevronDown /></DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="op-menu" :side="hosted ? 'bottom' : 'top'" :side-offset="8" align="start" style="min-width: 10rem">
                  <DropdownMenuItem v-for="key in tool.flyout" :key="key" class="op-menu-item" @select="actions.setTool(key)">
                    <component :is="toolIcons[key]" /><span class="label">{{ label[key] ?? key }}</span><span class="shortcut">{{ SHORTCUT[key] ?? '' }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>
          <button v-else type="button" class="op-tool" :data-testid="`tool-${tool.key.toLowerCase()}`" :title="tip(tool.key)" :data-active="activeTool === tool.key || undefined" @click="actions.setTool(tool.key)">
            <component :is="toolIcons[tool.key]" />
          </button>
        </template>
      </div>
    </ToolbarRoot>
  </div>
</template>
