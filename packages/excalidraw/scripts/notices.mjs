import {readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
export async function packageRoot(file) {
  let dir = dirname(await realpath(file));
  while (dirname(dir) !== dir) {
    try { const manifest = JSON.parse(await readFile(join(dir,'package.json'),'utf8')); if (manifest.name) return {dir,manifest}; } catch {}
    dir = dirname(dir);
  }
  throw new Error(`No package root for ${file}`);
}
export async function notices(meta) {
  const packages = new Map();
  for (const input of Object.keys(meta.inputs).filter(p => p.includes('node_modules/'))) {
    const pkg = await packageRoot(resolve(input)); packages.set(`${pkg.manifest.name}@${pkg.manifest.version}`, pkg);
  }
  let text = '';
  for (const [name,{dir,manifest}] of [...packages].sort()) {
    text += `\n--- ${name} ${manifest.version} (${manifest.license ?? 'see upstream'}) ---\n`;
    for (const file of (await readdir(dir)).filter(f => /^(license|copying|notice)(\.|$)/i.test(f))) {
      try {text += await readFile(join(dir,file),'utf8'); text += '\n';} catch {}
    }
  }
  await writeFile('dist/THIRD-PARTY-NOTICES.txt',text);
}
