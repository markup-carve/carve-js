import { readFileSync } from 'node:fs'
import { carveToMarkdown } from './src/index.js'

process.stdout.write(carveToMarkdown(readFileSync(process.argv[2]!, 'utf8')))
