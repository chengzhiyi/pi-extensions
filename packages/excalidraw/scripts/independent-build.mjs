// Offline verification only; copies resolved dependency files, never installs packages.
import {cp,mkdir,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {packageRoot} from './notices.mjs';
const require = createRequire(import.meta.url);
const root = resolve('.'), directory = resolve('../../artifacts/independent-build');
await rm(directory,{recursive:true,force:true}); await mkdir(directory,{recursive:true});
const metaPath=resolve('../../artifacts/build-meta.json');
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit',env:{...process.env,PI_EXCALIDRAW_BUILD_META:metaPath}});
const meta=JSON.parse(await readFile(metaPath,'utf8'));
const packages = new Map();
async function add(file) {
  const pkg=await packageRoot(file);
  if(packages.has(pkg.dir)) return packages.get(pkg.dir);
  pkg.target=join(directory,'node_modules/.closure',createHash('sha256').update(pkg.dir).digest('hex').slice(0,16));
  packages.set(pkg.dir,pkg); return pkg;
}
for(const input of Object.keys(meta.inputs).filter(p=>p.includes('node_modules/'))) await add(resolve(input));
const esbuild=await add(require.resolve('esbuild'));
const platform=`@esbuild/${process.platform}-${process.arch}`;
await add(createRequire(join(esbuild.dir,'package.json')).resolve(`${platform}/bin/esbuild`));
// Preserve original nested versions; flattening d3 dependencies silently picks incompatible majors.
async function lookup(dir,name) {
  while(dirname(dir)!==dir) {
    try {return await realpath(join(dir,'node_modules',name));} catch {}
    dir=dirname(dir);
  }
  return null;
}
async function link(target, path) {await mkdir(dirname(path),{recursive:true}); await symlink(target,path,'dir');}
for(const pkg of packages.values()) {
  await mkdir(dirname(pkg.target),{recursive:true});
  await cp(pkg.dir,pkg.target,{recursive:true,dereference:true,filter:p=>p===pkg.dir || !p.slice(pkg.dir.length+1).split('/').includes('node_modules')});
}
for(const pkg of packages.values()) {
  for(const name of Object.keys({...pkg.manifest.dependencies,...pkg.manifest.optionalDependencies,...pkg.manifest.peerDependencies})) {
    const dir=await lookup(pkg.dir,name); const dependency=packages.get(dir);
    if(dependency) await link(dependency.target,join(pkg.target,'node_modules',name));
  }
}
const manifest=JSON.parse(await readFile('package.json','utf8'));
for(const name of ['esbuild','react','react-dom','@excalidraw/excalidraw']) {
  const pkg=packages.get((await packageRoot(require.resolve(name))).dir);
  if(pkg?.manifest.version!==manifest.devDependencies[name]) throw new Error(`Build dependency drift: ${name}`);
  await link(pkg.target,join(directory,'node_modules',name));
}
for(const path of ['src','scripts','NOTICE.txt','LICENSE','package.json']) await cp(path,join(directory,path),{recursive:true});
const isolatedMeta=join(directory,'isolated-meta.json');
execFileSync(process.execPath,['scripts/build.mjs'],{cwd:directory,stdio:'inherit',env:{...process.env,NODE_PATH:'',PI_EXCALIDRAW_BUILD_META:isolatedMeta}});
const rebuilt=JSON.parse(await readFile(isolatedMeta,'utf8'));
for(const input of Object.keys(rebuilt.inputs)) {
  const actual=await realpath(resolve(directory,input));
  if(!actual.startsWith(directory+'/')) throw new Error(`Host resolution leak: ${actual}`);
}
// Chunk hashes can differ because closure layout differs; integrity verification checks each output separately.
const resources=JSON.parse(await readFile(join(directory,'dist/resources.json'),'utf8'));
if(resources.files.length!==JSON.parse(await readFile(join(root,'dist/resources.json'),'utf8')).files.length) throw new Error('Independent resource count differs');
console.log(`Independent offline build passed: ${packages.size} copied package versions, no host dependency resolution`);
