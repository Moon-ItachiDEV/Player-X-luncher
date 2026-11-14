// Tous les tests (npm test) : chaque fichier *.test.ts de src/ est trouvé ici, sans liste à tenir à la main.
// Avant, `npm test` enchaînait dix-sept listes écrites dans package.json : un test oublié dans ces listes n'aurait jamais
// tourné, sans que rien ne le dise. Les scripts `test:launch`, `test:clips`… restent, pour ne lancer qu'un groupe.
// `npm test -- clips edit` : seulement les fichiers dont le chemin contient l'un de ces mots.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Les mots se comparent sans majuscules et avec des « / », pour que `npm test -- services/clips` marche aussi sous Windows.
const plain = (s) => s.toLowerCase().replaceAll('\\', '/')
const only = process.argv.slice(2).map(plain)
const all = readdirSync(join(root, 'src'), { recursive: true })
  .map((f) => join('src', String(f)))
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
const files = only.length ? all.filter((f) => only.some((w) => plain(f).includes(w))) : all

if (!files.length) {
  // Un `npm test` qui ne trouve rien ne doit jamais passer pour une réussite.
  console.error(only.length ? `Aucun fichier de test ne contient « ${only.join(' » ni « ')} » (${all.length} fichiers de tests dans src/).` : 'Aucun fichier de test trouvé dans src/.')
  process.exit(1)
}
console.log(`${files.length} fichier${files.length > 1 ? 's' : ''} de tests${only.length ? ` sur ${all.length}` : ''}`)
// Le crochet test-resolve.mjs ne fait qu'ajouter des résolutions (alias @shared, extension .ts) : sans effet sur les tests
// qui s'en passaient.
const run = spawnSync(process.execPath, ['--import', './scripts/test-resolve.mjs', '--experimental-strip-types', '--test', ...files], { cwd: root, stdio: 'inherit' })
process.exit(run.status ?? 1)
