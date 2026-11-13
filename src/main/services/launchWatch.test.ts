// Tests du suivi rapide (npm run test:launch) : vrai createWatcher, faux powershell.exe (entrée et sortie en mémoire) et
// fausses minuteries. launchWatch.ts importe launchWatchParse sans extension : lancé avec scripts/test-resolve.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
// Node exige l'extension ; TypeScript ne la permet que via allowImportingTsExtensions, absent du tsconfig de l'appli.
// @ts-ignore TS5097
import { createWatcher, type Spawn } from './launchWatch.ts'
// @ts-ignore TS5097
import { MIN_PROCS, SCRIPT } from './launchWatchParse.ts'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Faux powershell.exe : ce que Node lui écrit, et ce qu'il répond à la demande. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kills = 0
  lines: string[] = []

  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => this.lines.push(...chunk.split('\n').filter(Boolean)))
  }

  kill(): boolean {
    this.kills++
    if (this.exitCode === null && this.signalCode === null) {
      this.signalCode = 'SIGTERM'
      setImmediate(() => this.emit('exit', null, 'SIGTERM'))
    }
    return true
  }

  reply(line: string): void {
    this.stdout.write(line + '\n')
  }
}

/** Relevé valable : assez de programmes, coût du script en ms et en octets. */
const sample = (cpuMs: number, procs = MIN_PROCS + 5): string =>
  'S' + Array.from({ length: procs }, (_, i) => `\t${100 + i}:svc${i}`).join('') + `\tC:${cpuMs}:50000000`

function harness() {
  let clock = 0
  let seq = 0
  let queue: { at: number; id: number; fn: () => void }[] = []
  const timers = {
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = ++seq
      queue.push({ at: clock + Math.max(0, ms), id, fn })
      return id
    },
    clearTimeout: (id: unknown): void => {
      queue = queue.filter((t) => t.id !== id)
    }
  }
  async function advance(ms: number): Promise<void> {
    const end = clock + ms
    for (;;) {
      await flush()
      queue.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = queue[0]
      if (!next || next.at > end) break
      queue.shift()
      clock = next.at
      next.fn()
    }
    clock = end
    await flush()
  }
  const children: FakeChild[] = []
  const spawned: { cmd: string; args: string[]; opts: unknown }[] = []
  let spawnFails = false
  const spawn: Spawn = (cmd, args, opts) => {
    if (spawnFails) throw new Error('spawn powershell.exe ENOENT')
    spawned.push({ cmd, args, opts })
    const c = new FakeChild()
    children.push(c)
    return c as unknown as ChildProcess
  }
  const downs: string[] = []
  const watcher = createWatcher({ spawn, now: () => clock, timers, log: () => {}, onDown: (why) => void downs.push(why) })
  return {
    watcher,
    advance,
    children,
    spawned,
    downs,
    now: () => clock,
    child: () => children.at(-1)!,
    failSpawn: () => void (spawnFails = true)
  }
}

test('un seul powershell.exe, caché, piloté par l’entrée standard ; une ligne par relevé', async () => {
  const h = harness()
  const a = h.watcher.sample({ w: [['CS2']], s: ['730'] })
  await flush()
  assert.deepEqual(h.spawned, [
    {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', SCRIPT],
      opts: { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    }
  ])
  assert.deepEqual(h.child().lines, ['{"w":["cs2"],"s":["730"]}'])
  h.child().reply(sample(400))
  const s = await a
  assert.equal(s?.procs.length, MIN_PROCS + 5)
  assert.equal(h.watcher.alive(), true)
  assert.equal(h.watcher.last()?.at, h.now())
  const b = h.watcher.sample({})
  await flush()
  h.child().reply(sample(420))
  assert.ok(await b)
  assert.equal(h.children.length, 1)
  assert.deepEqual(h.child().lines.at(-1), '{}')
})

test('délai : 10 s pour le premier relevé (démarrage à froid), 3 s ensuite', async () => {
  const h = harness()
  for (const ms of [10_000, 3_000]) {
    let done = false
    const p = h.watcher.sample({})
    void p.then(() => {
      done = true
    })
    await h.advance(ms - 1)
    assert.equal(done, false)
    await h.advance(1)
    assert.equal(await p, null)
  }
  assert.deepEqual(h.downs, [])
})

test('3 relevés ratés d’affilée → hors service une seule fois, processus arrêté', async () => {
  const h = harness()
  for (let i = 0; i < 3; i++) {
    const p = h.watcher.sample({})
    await h.advance(10_000)
    assert.equal(await p, null)
  }
  assert.deepEqual(h.downs, ['pas de réponse'])
  assert.equal(h.children[0].kills, 1)
  assert.equal(h.watcher.alive(), false)
  await h.advance(5_000)
  assert.equal(h.downs.length, 1)
})

test('un relevé valable remet le compte à zéro ; un relevé tronqué compte comme un raté', async () => {
  const h = harness()
  const fail = async (): Promise<void> => {
    const p = h.watcher.sample({})
    await h.advance(10_000)
    assert.equal(await p, null)
  }
  /** PowerShell répond enfin aux deux relevés ratés (réponses jetées), puis au relevé en cours. */
  const answer = (line: string): void => {
    for (const late of [sample(50), sample(60)]) h.child().reply(late)
    h.child().reply(line)
  }
  await fail()
  await fail()
  const ok = h.watcher.sample({})
  await flush()
  answer(sample(100))
  assert.ok(await ok)
  await fail()
  await fail()
  assert.deepEqual(h.downs, [])
  // Trop peu de programmes : relevé tronqué, le troisième raté d'affilée.
  const short = h.watcher.sample({})
  await flush()
  answer(sample(120, MIN_PROCS))
  assert.equal(await short, null)
  assert.deepEqual(h.downs, ['relevé tronqué'])
  // Ligne illisible, relevé vide, trop peu de programmes : trois relevés tronqués.
  const h2 = harness()
  for (const line of ['garbage', 'S', sample(5, 3)]) {
    const p = h2.watcher.sample({})
    await flush()
    h2.child().reply(line)
    assert.equal(await p, null)
  }
  assert.deepEqual(h2.downs, ['relevé tronqué'])
})

test('réponse en retard : jetée, la suivante répond au relevé en cours', async () => {
  const h = harness()
  const a = h.watcher.sample({})
  await h.advance(10_000)
  assert.equal(await a, null)
  const b = h.watcher.sample({})
  await flush()
  // Réponse au premier relevé, arrivée trop tard, puis celle du second.
  h.child().reply(sample(100, MIN_PROCS + 1))
  await flush()
  h.child().reply(sample(130, MIN_PROCS + 7))
  const s = await b
  assert.equal(s?.procs.length, MIN_PROCS + 7)
})

test('arrêté sans qu’on le demande, ou introuvable → hors service', async () => {
  const h = harness()
  const a = h.watcher.sample({})
  await flush()
  h.child().emit('exit', 1, null)
  assert.equal(await a, null)
  assert.deepEqual(h.downs, ['arrêté'])
  assert.equal(h.watcher.alive(), false)

  const h2 = harness()
  const b = h2.watcher.sample({})
  await flush()
  h2.child().emit('error', new Error('spawn powershell.exe ENOENT'))
  assert.equal(await b, null)
  assert.deepEqual(h2.downs, ['PowerShell introuvable'])

  const h3 = harness()
  h3.failSpawn()
  assert.equal(await h3.watcher.sample({}), null)
  assert.deepEqual(h3.downs, ['PowerShell introuvable'])
})

test('stop() : fin de l’entrée, arrêt forcé 1 s après s’il tourne encore, jamais « hors service »', async () => {
  const h = harness()
  const a = h.watcher.sample({})
  await flush()
  h.child().reply(sample(100))
  await a
  const c = h.child()
  h.watcher.stop()
  assert.equal(c.stdin.writableEnded, true)
  assert.equal(h.watcher.alive(), false)
  await h.advance(999)
  assert.equal(c.kills, 0)
  await h.advance(1)
  assert.equal(c.kills, 1)
  await h.advance(1_000)
  assert.deepEqual(h.downs, [])

  // Arrêté seul à la fin de l'entrée : pas d'arrêt forcé.
  const h2 = harness()
  const b = h2.watcher.sample({})
  await flush()
  const c2 = h2.child()
  h2.watcher.stop()
  assert.equal(await b, null)
  c2.exitCode = 0
  c2.emit('exit', 0, null)
  await h2.advance(2_000)
  assert.equal(c2.kills, 0)
  assert.deepEqual(h2.downs, [])

  // stop(true) : tout de suite. Relevé suivant : nouveau processus.
  const h3 = harness()
  void h3.watcher.sample({})
  await flush()
  h3.watcher.stop(true)
  assert.equal(h3.children[0].kills, 1)
  void h3.watcher.sample({})
  await flush()
  assert.equal(h3.children.length, 2)
  await h3.advance(2_000)
  assert.deepEqual(h3.downs, [])
})

test('coût : temps processeur par relevé sans le démarrage, mémoire du dernier relevé', async () => {
  const h = harness()
  for (const cpu of [900, 920, 950, 960]) {
    const p = h.watcher.sample({})
    await flush()
    h.child().reply(sample(cpu))
    await p
  }
  assert.deepEqual(h.watcher.cost(), { p95CpuMs: 30, ws: 50_000_000, samples: 3 })
})
