import { expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve, parse } from '../src/index.js'

it.each(['a`b', 'src/`Auth.php', 'a~~~b'])('keeps header bytes in a valid fence: %s', header => {
  const source = `\`\`\`php "${header}"\n~~~\n$ok = true;\n\`\`\`\n`
  const markdown = carveToMarkdown(source)
  expect(markdown).toContain(`"${header}"`)
  expect(markdown.split('\n')[0]).toBe(`${header.includes('`') ? '~~~~' : '```'}php "${header}"`)
  const tree = parse(markdownToCarve(markdown))
  expect(tree.children[0]?.type).toBe('code_block')
  if (tree.children[0]?.type === 'code_block') expect(tree.children[0].content).toBe('~~~\n$ok = true;\n')
})
