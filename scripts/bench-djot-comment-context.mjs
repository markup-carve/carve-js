import {performance} from 'node:perf_hooks'
import {djotToCarve} from '../dist/index.js'
for (const family of process.argv.includes('--quoted') ? ['quoted'] : ['paragraph', 'blocks']) {
  for (const count of [500, 1000, 2000, 4000]) {
    const source = family === 'quoted' ? '> {% x %\n>\n'.repeat(count) : family === 'paragraph' ? 'a\n' + '{% x\ny %}\n'.repeat(count) : '{% x\n  y %}\n'.repeat(count)
    djotToCarve(source)
    const samples = []
    for (let n = 0; n < 3; n++) {
      const start = performance.now()
      djotToCarve(source)
      samples.push(Math.round(performance.now() - start))
    }
    console.log(JSON.stringify({family, count, bytes: source.length, milliseconds: samples}))
  }
}
