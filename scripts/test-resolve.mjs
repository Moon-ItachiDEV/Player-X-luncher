// Tests (npm test) : les modules de l'interface s'importent entre eux sans extension, comme Vite les résout.
// Node exige l'extension : ce crochet ajoute « .ts » quand le chemin relatif seul ne mène à rien.
// Il résout aussi l'alias « @shared/x » (electron.vite.config.ts) vers src/shared/x.ts.
// registerHooks (Node ≥ 22.15) est synchrone ; avant, le même crochet passe par register (asynchrone).
import * as nodeModule from 'node:module'

const bare = (specifier) => /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)
/** Dossier src/shared, en adresse absolue : calculée ici, puis écrite en dur dans le crochet asynchrone (une URL data: n'a pas d'import.meta.url utile). */
const SHARED = new URL('../src/shared/', import.meta.url).href
const shared = (specifier, root) =>
  specifier.startsWith('@shared/') ? new URL(specifier.slice('@shared/'.length) + (/\.(?:[cm]?[jt]sx?|json)$/.test(specifier) ? '' : '.ts'), root).href : null

if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const alias = shared(specifier, SHARED)
      if (alias) return next(alias, context)
      try {
        return next(specifier, context)
      } catch (e) {
        if (bare(specifier)) return next(`${specifier}.ts`, context)
        throw e
      }
    }
  })
} else {
  const hook = `const bare = ${bare.toString()}
const shared = ${shared.toString()}
const SHARED = ${JSON.stringify(SHARED)}
export async function resolve(specifier, context, next) {
  const alias = shared(specifier, SHARED)
  if (alias) return next(alias, context)
  try {
    return await next(specifier, context)
  } catch (e) {
    if (bare(specifier)) return next(specifier + '.ts', context)
    throw e
  }
}`
  nodeModule.register(`data:text/javascript,${encodeURIComponent(hook)}`)
}
