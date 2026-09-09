import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const cache=new Map();
export async function moduleURLFor(file) {
  const path=resolve(file);
  if(cache.has(path))return cache.get(path);
  let source=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const imports=[...source.matchAll(/from ['"]([^'"]+)['"]/g)];
  for(const match of imports) {
    const name=match[1];
    const url=name.startsWith('.')?await moduleURLFor(resolve(dirname(path),name+'.ts')):import.meta.resolve(name);
    source=source.replace(match[0],`from ${JSON.stringify(url)}`);
  }
  for(const match of source.matchAll(/import\(['"]([^'"]+)['"]\)/g)) {
    const name=match[1];
    const url=name.startsWith('.')?await moduleURLFor(resolve(dirname(path),name+'.ts')):import.meta.resolve(name);
    source=source.replace(match[0],`import(${JSON.stringify(url)})`);
  }
  // The project modules in these tests have no cyclic runtime dependencies.
  const url='data:text/javascript;base64,'+Buffer.from(source+`\n//# sourceURL=${pathToFileURL(path).href}`).toString('base64');cache.set(path,url);return url;
}
