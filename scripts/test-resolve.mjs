// Tests (npm test) : les modules de l'interface s'importent entre eux sans extension, comme Vite les résout.
// Node exige l'extension : ce crochet ajoute « .ts » quand le chemin relatif seul ne mène à rien.
// Il résout aussi l'alias « @shared/x » (electron.vite.config.ts) vers src/shared/x.ts.
// registerHooks (Node ≥ 22.15) est synchrone ; avant, le même crochet passe par register (asynchrone).
import * as nodeModule from 'node:module'

const bare = (specifier) => /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)
/** Dossiers src/ et src/shared/, en adresses absolues : calculées ici, puis écrites en dur dans le crochet asynchrone (une URL data: n'a pas d'import.meta.url utile). */
const SRC = new URL('../src/', import.meta.url).href
const SHARED = new URL('../src/shared/', import.meta.url).href
const shared = (specifier, root) =>
  specifier.startsWith('@shared/') ? new URL(specifier.slice('@shared/'.length) + (/\.(?:[cm]?[jt]sx?|json)$/.test(specifier) ? '' : '.ts'), root).href : null
const asEsmTs = (res, srcRoot) => (res && typeof res.url === 'string' && res.url.startsWith(srcRoot) && res.url.endsWith('.ts') ? { ...res, format: 'module-typescript' } : res)

if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const alias = shared(specifier, SHARED)
      if (alias) return asEsmTs(next(alias, context), SRC)
      try {
        return asEsmTs(next(specifier, context), SRC)
      } catch (e) {
        if (bare(specifier)) return asEsmTs(next(`${specifier}.ts`, context), SRC)
        throw e
      }
    }
  })
} else {
  const hook = `const bare = ${bare.toString()}
const shared = ${shared.toString()}
const asEsmTs = ${asEsmTs.toString()}
const SRC = ${JSON.stringify(SRC)}
const SHARED = ${JSON.stringify(SHARED)}
export async function resolve(specifier, context, next) {
  const alias = shared(specifier, SHARED)
  if (alias) return asEsmTs(await next(alias, context), SRC)
  try {
    return asEsmTs(await next(specifier, context), SRC)
  } catch (e) {
    if (bare(specifier)) return asEsmTs(await next(specifier + '.ts', context), SRC)
    throw e
  }
}`
  nodeModule.register(`data:text/javascript,${encodeURIComponent(hook)}`)
}
