// Spike fixture: the login screen a PencilOp batch would produce, written against the typed Figma
// Plugin API (no eval). Shared by the Node probe and the browser frame so layout/pixels compare.
export const CJK_FAMILY = 'Noto Sans SC';
const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const solid = (hex) => [{ type: 'SOLID', color: rgb(hex) }];

export async function loadFixtureFonts(figma) {
  for (const style of ['Regular', 'Medium', 'Bold']) await figma.loadFontAsync({ family: CJK_FAMILY, style });
}

/** Returns the screen node proxy. Auto-layout containers hug their cross axis (adapter default). */
export function buildLoginScreen(figma, { x = 0, y = 0 } = {}) {
  const screen = figma.createFrame();
  screen.name = 'Login'; screen.x = x; screen.y = y; screen.resize(390, 844); screen.fills = solid('#FFFFFF');
  screen.layoutMode = 'VERTICAL'; screen.itemSpacing = 16;
  screen.paddingTop = 64; screen.paddingBottom = 24; screen.paddingLeft = 24; screen.paddingRight = 24;
  screen.primaryAxisSizingMode = 'FIXED'; screen.counterAxisSizingMode = 'FIXED';
  const label = (chars, size, style = 'Regular', color = '#111827') => {
    const t = figma.createText(); t.fontName = { family: CJK_FAMILY, style }; t.characters = chars; t.fontSize = size; t.fills = solid(color); return t;
  };
  const title = label('登录 / ログイン', 28, 'Bold'); title.name = 'Title';
  const subtitle = label('欢迎回来，请输入账号信息。Welcome back.', 15, 'Regular', '#6B7280'); subtitle.name = 'Subtitle';
  const field = (name, placeholder) => {
    const f = figma.createFrame(); f.name = name; f.layoutMode = 'HORIZONTAL';
    f.paddingLeft = f.paddingRight = 16; f.paddingTop = f.paddingBottom = 14; f.cornerRadius = 12;
    f.fills = solid('#F3F4F6'); f.strokes = solid('#E5E7EB'); f.strokeWeight = 1;
    f.appendChild(label(placeholder, 16, 'Regular', '#9CA3AF')); f.layoutSizingVertical = 'HUG'; return f;
  };
  const email = field('Email', '邮箱 Email'), password = field('Password', '密码 Password');
  const button = figma.createFrame(); button.name = 'Primary button'; button.layoutMode = 'HORIZONTAL';
  button.primaryAxisAlignItems = 'CENTER'; button.counterAxisAlignItems = 'CENTER';
  button.paddingTop = button.paddingBottom = 14; button.cornerRadius = 12; button.fills = solid('#4F46E5');
  button.appendChild(label('登录', 16, 'Medium', '#FFFFFF')); button.layoutSizingVertical = 'HUG';
  const forgot = label('忘记密码？', 14, 'Regular', '#4F46E5'); forgot.name = 'Forgot';
  for (const n of [title, subtitle, email, password, button, forgot]) screen.appendChild(n);
  for (const n of [subtitle, email, password, button]) n.layoutSizingHorizontal = 'FILL';
  subtitle.textAutoResize = 'HEIGHT';
  for (const f of [email, password]) f.children[0].layoutSizingHorizontal = 'FILL';
  return screen;
}

/** Bounds of the screen and each descendant, for cross-runtime layout comparison. */
export function layoutSnapshot(graph, rootId) {
  const rows = [];
  const walk = (id, depth) => {
    const n = graph.getNode(id); if (!n) return;
    rows.push({ depth, name: n.name, type: n.type, x: +n.x.toFixed(2), y: +n.y.toFixed(2), w: +n.width.toFixed(2), h: +n.height.toFixed(2) });
    for (const c of n.childIds ?? []) walk(c, depth + 1);
  };
  walk(rootId, 0);
  return rows;
}
