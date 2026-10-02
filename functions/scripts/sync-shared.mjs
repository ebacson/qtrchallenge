// Copy the web's pure challenge logic into functions/src so the server computes
// progress and level exactly like the web. Run from the functions/ directory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const FILES = [
  ['../web/src/lib/challengeRules.ts', 'src/shared/challengeRules.ts'],
  ['../web/src/lib/levelCalculator.ts', 'src/shared/levelCalculator.ts'],
  ['../web/src/lib/progressCompute.ts', 'src/shared/progressCompute.ts'],
  ['../web/src/lib/userProfile.ts', 'src/shared/userProfile.ts'],
  ['../web/src/types/index.ts', 'src/types/index.ts'],
]

for (const [from, to] of FILES) {
  if (!existsSync(from)) {
    console.warn(`sync-shared: ${from} not found, keeping existing ${to}`)
    continue
  }
  const header = `// GENERATED from ${from.replace('../', '')} by scripts/sync-shared.mjs — edit the web copy.\n`
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, header + readFileSync(from, 'utf8'))
}
