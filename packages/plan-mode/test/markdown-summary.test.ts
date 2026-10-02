import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMarkdownPlainText } from '../src/ui/primitives/markdown/plain-text.ts';

test('plan summaries skip headings and preserve Chinese emphasis, link labels and code', () => {
  const markdown = '# 标题\n\n**先确认**中文 [范围](https://example.com)，再执行 `read`。\n\n后续步骤。';
  assert.equal(extractMarkdownPlainText(markdown, { mode: 'first-paragraph' }), '先确认中文 范围，再执行 read。');
  assert.equal(extractMarkdownPlainText(markdown), '标题\n\n先确认中文 范围，再执行 read。\n\n后续步骤。');
});

test('local image paths with spaces contribute alt text across supported formats and separators', () => {
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif']) {
    for (const path of [`/tmp/project images/diagram.${extension.toUpperCase()}`, `C:\\project images\\diagram.${extension}`, `../project images/diagram.${extension}`]) {
      assert.equal(extractMarkdownPlainText(`![架构图](${path})`, { mode: 'first-paragraph' }), '架构图', path);
    }
  }
});

test('local image recovery leaves file references, escaped examples and code literal', () => {
  const example = '![文件](/tmp/project images/plan.txt)';
  assert.equal(extractMarkdownPlainText(example), example);
  const image = '![示例](/tmp/project images/diagram.png)';
  assert.equal(extractMarkdownPlainText(`\`${image}\``), image);
  assert.equal(extractMarkdownPlainText(`\\${image}`), image);
  assert.equal(extractMarkdownPlainText(`\`\`\`markdown\n${image}\n\`\`\``), image);
});
