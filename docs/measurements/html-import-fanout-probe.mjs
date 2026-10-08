import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const engine = await import(process.argv[2] + '/dist/index.js')
const shape = process.argv[3], api = process.argv[5] ?? 'carve'
for (const n of process.argv[4].split(',').map(Number)) {
  const source = readFileSync(`/tmp/carve-footnote-fixtures/${shape}-${n}.html`, 'utf8')
  const call = () => {
    try { return (api === 'ast' ? engine.htmlToAst : engine.htmlToCarve)(source, {adapter:'word'}) }
    catch (e) { return {error:e.name, message:e.message, kind:e.kind} }
  }
  call()
  const samples = [], hashes = []
  for (let i = 0; i < 3; i++) {
    global.gc?.()
    const start = performance.now()
    const out = call()
    samples.push(performance.now() - start)
    hashes.push(createHash('sha256').update(JSON.stringify(out)).digest('hex'))
  }
  console.log(JSON.stringify({n,bytes:Buffer.byteLength(source),api,samples,hashes}))
}
