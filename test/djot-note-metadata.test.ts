import {describe,it,expect} from 'vitest'
import {djotToCarve,carveToHtml,migrateDjot} from '../src/index.js'
import fixtures from './fixtures/djot-note-metadata.json'
describe('Djot footnote definition attributes',()=>{
for(const row of fixtures) it(row.name,()=>{
const result=migrateDjot(row.source)
expect(result.value).toBe(djotToCarve(row.source))
const losses=result.report.diagnostics.filter(d=>d.code==='djot-footnote-definition-attributes-dropped')
expect(losses.map(d=>d.path)).toEqual(row.lossLines.map(line=>`line:${line}`))
for(const loss of losses){expect(loss.fidelity).toBe('dropped');expect(loss.confidence).toBe('exact')}
if('html' in row) expect(carveToHtml(result.value).trim().replace(/ aria-label="[^"]*"/g,'').replaceAll('↩︎','↩').replace(/(<li>)\n/g,'$1').replace(/\n(<\/li>)/g,'$1').replace(/<\/?tbody>/g,'').replace(/<ol type="([^"]+)" start="([^"]+)">/g,'<ol start="$2" type="$1">').replace(/>\s+</g,'><')).toBe(row.html)
})
})
