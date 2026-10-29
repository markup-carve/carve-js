import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a marker below a quote opened past the item content column', () => {
  expect(carveToHtml('1. ordered\n  :: term\n  :  detail\n    > quote\n\tq\n        - item')).toContain(
    '<blockquote><p>quote\nq\n- item</p></blockquote>',
  )
})

it('lets a blank end the quote claim before a marker', () => {
  expect(carveToHtml('- a\n  > q\n\n  - b')).toContain('<ul>\n      <li>b</li>')
})

it('recognizes a sibling marker before the quote claim', () => {
  expect(carveToHtml('- a\n  > q\n- b')).toContain('  <li>b</li>')
})

it('opens a fence at the item content column after quoted prose', () => {
  expect(carveToHtml('- a\n  > q\n  ```\n  code\n  ```')).toContain('<pre><code>code\n</code></pre>')
})

it('recognizes a nested item sibling before the outer quote claim', () => {
  const html = carveToHtml('- a\n  - b\n    > q\n  - c')
  expect(html).toContain('<blockquote><p>q</p></blockquote>')
  expect(html).toContain('      <li>c</li>')
})

it('ends a description quote claim at its heading column', () => {
  const html = carveToHtml('- a\n  :: t\n  :  d\n     > q\n     # h\n  - m')
  expect(html).toContain('<h1 id="h">h</h1>')
  expect(html).toContain('    <ul>\n      <li>m</li>')
})

it('ends a nested quote claim at its heading column', () => {
  const html = carveToHtml('- a\n  - b\n    > q\n    # h\n    - c')
  expect(html).toContain('<h1 id="h">h</h1>')
  expect(html).toContain('        <ul>\n          <li>c</li>')
})

it('ends an authored quote claim at a line comment', () => {
  const html = carveToHtml('- a\n   > q\n  %% c\n  - m')
  expect(html).toContain('<blockquote><p>q</p></blockquote>')
  expect(html).toContain('    <ul>\n      <li>m</li>')
})

it('keeps a marker after a quoted caption in the caption paragraph', () => {
  for (const quote of ['  > q', '   > q']) {
    const html = carveToHtml(`- a\n${quote}\n  ^ cap\n  - m`)
    expect(html).toContain('<figcaption>cap\n- m</figcaption>')
    expect(html).not.toContain('\0L\0')
  }
})

it('does not claim a quote marker inside an inline code span', () => {
  const html = carveToHtml('- a\n  ```\n   > q\n   ```\n  - m')
  expect(html).toContain('    <ul>\n      <li>m</li>')
})

it('ends an authored quote claim on a quoted heading or table', () => {
  for (const block of ['# h', '| t |']) {
    const html = carveToHtml(`- a\n   > q\n   > ${block}\n  - m`)
    expect(html).toContain('    <ul>\n      <li>m</li>')
  }
})

it('ends a caption claim on a line comment at any column', () => {
  for (const comment of ['  %% c', '   %% c']) {
    const html = carveToHtml(`- a\n  > q\n  ^ cap\n${comment}\n  - m`)
    expect(html).toContain('    <ul>\n      <li>m</li>')
  }
})

it('ends a caption claim on a block attribute at its host column', () => {
  const html = carveToHtml('- a\n  > q\n  ^ cap\n  {.x}\n  - m')
  expect(html).toContain('    <ul class="x">\n      <li>m</li>')
})

it('attaches an attribute past the caption host column to the next block', () => {
  const html = carveToHtml('- a\n  > q\n  ^ cap\n   {.x}\n  - m')
  expect(html).toContain('<figcaption>cap</figcaption>\n    </figure>\n    <ul class="x">')
})
