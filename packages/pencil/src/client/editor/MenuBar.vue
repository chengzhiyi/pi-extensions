<script setup>
// Menu bar under the document name, as in OpenPencil: File (pi-pencil's own document actions),
// then the SDK's Edit / View / Object / Text / Arrange menus with their shortcuts.
import { computed } from 'vue';
import { Check, ChevronRight } from 'lucide-vue-next';
import {
  MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarItemIndicator, MenubarMenu, MenubarPortal, MenubarRoot,
  MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger,
} from 'reka-ui';
import { formatShortcut } from '@open-pencil/vue/editor/commands';
import { useMenuModel } from '@open-pencil/vue/editor/menu-model';
import { useTypography } from '@open-pencil/vue/controls/typography';
import { useI18n } from '@open-pencil/vue/i18n';

const props = defineProps({ fileItems: { type: Array, default: () => [] } });
const { appMenu } = useMenuModel();
const { menu: m } = useI18n();
const typo = useTypography();
const textMenu = computed(() => [
  { label: m.value.bold, shortcut: formatShortcut('MOD+B'), action: typo.toggleBold, disabled: !typo.node.value },
  { label: m.value.italic, shortcut: formatShortcut('MOD+I'), action: typo.toggleItalic, disabled: !typo.node.value },
  { label: m.value.underline, shortcut: formatShortcut('MOD+U'), action: () => typo.toggleDecoration('UNDERLINE'), disabled: !typo.node.value },
  { label: m.value.strikethrough, shortcut: formatShortcut('MOD+SHIFT+X'), action: () => typo.toggleDecoration('STRIKETHROUGH'), disabled: !typo.node.value },
]);
const menus = computed(() => {
  const [edit, view, object, arrange] = appMenu.value;
  return [{ label: m.value.file, items: props.fileItems }, edit, view, object, { label: m.value.text, items: textMenu.value }, arrange].filter(Boolean);
});
const isSep = (item) => item.separator === true;
const run = (item) => { if (!item.disabled) item.action?.(); };
</script>

<template>
  <div class="op-menubar">
    <MenubarRoot style="display: flex; gap: 0.125rem">
      <MenubarMenu v-for="menu in menus" :key="menu.label">
        <MenubarTrigger class="op-menubar-trigger" :data-testid="`menubar-${menu.label}`">{{ menu.label }}</MenubarTrigger>
        <MenubarPortal>
          <MenubarContent class="op-menu" :side-offset="4" align="start">
            <template v-for="(item, i) in menu.items" :key="i">
              <MenubarSeparator v-if="isSep(item)" class="op-menu-sep" />
              <MenubarSub v-else-if="item.sub?.length">
                <MenubarSubTrigger class="op-menu-item" :disabled="item.disabled"><span class="label">{{ item.label }}</span><ChevronRight /></MenubarSubTrigger>
                <MenubarPortal>
                  <MenubarSubContent class="op-menu" :side-offset="4">
                    <template v-for="(sub, j) in item.sub" :key="j">
                      <MenubarSeparator v-if="isSep(sub)" class="op-menu-sep" />
                      <MenubarItem v-else class="op-menu-item" :disabled="sub.disabled" @select="run(sub)"><span class="label">{{ sub.label }}</span><span v-if="sub.shortcut" class="shortcut">{{ sub.shortcut }}</span></MenubarItem>
                    </template>
                  </MenubarSubContent>
                </MenubarPortal>
              </MenubarSub>
              <MenubarCheckboxItem v-else-if="item.checked !== undefined" class="op-menu-item" :model-value="item.checked" @update:model-value="item.onCheckedChange?.($event)">
                <span class="label">{{ item.label }}</span><MenubarItemIndicator><Check /></MenubarItemIndicator>
              </MenubarCheckboxItem>
              <MenubarItem v-else class="op-menu-item" :disabled="item.disabled" :data-testid="item.testId" @select="run(item)">
                <span class="label">{{ item.label }}</span><span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
              </MenubarItem>
            </template>
          </MenubarContent>
        </MenubarPortal>
      </MenubarMenu>
    </MenubarRoot>
  </div>
</template>
