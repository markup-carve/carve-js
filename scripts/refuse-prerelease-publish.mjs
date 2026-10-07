// main reads X.Y.Z-dev between releases; only a cut version may reach npm.
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Refusing to publish ${version}: only a plain X.Y.Z version is released. Cut the release first.`)
  process.exit(1)
}
