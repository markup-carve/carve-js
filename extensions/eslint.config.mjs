import config from '../eslint.config.mjs'

export default [...config, {
  files: ['extensions/**/*.ts', 'test/extension-migration/**/*.ts'],
  languageOptions: { parserOptions: { project: ['./extensions/tsconfig.json'] } },
}]
