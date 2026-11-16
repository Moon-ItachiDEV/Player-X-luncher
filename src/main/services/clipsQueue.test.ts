// Tests de la file d'attente des fichiers des clips (npm test -- clipsQueue).
// Les travaux d'essai s'arrêtent sur une porte que le test ouvre lui-même : aucun contrôle ne dépend d'une durée.
// La file est gardée par le module : chaque test la laisse vide, sauf le dernier (voir sa note).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesBusy, filesDone, forgetFiles, serial } from './clipsQueue'

/** Une porte : le travail attend dessus jusqu'à ce que le test l'ouvre. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => {}
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

/** Laisse avancer tout ce qui peut avancer sans ouvrir de porte. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('un travail à la fois, dans l’ordre des demandes, et chacun reçoit son résultat', async () => {
  const seen: string[] = []
  const g1 = gate()
  const g2 = gate()
  const a = serial(async () => {
    seen.push('a commence')
    await g1.wait
    seen.push('a finit')
    return 1
  })
  const b = serial(async () => {
    seen.push('b commence')
    await g2.wait
    seen.push('b finit')
    return 2
  })
  const c = serial(async () => {
    seen.push('c')
    return 3
  })
  await settle()
  assert.deepEqual(seen, ['a commence'], 'b et c attendent la fin de a')
  // La porte de b ouverte en premier : b ne passe pas devant a pour autant.
  g2.open()
  await settle()
  assert.deepEqual(seen, ['a commence'])
  g1.open()
  assert.deepEqual(await Promise.all([a, b, c]), [1, 2, 3])
  assert.deepEqual(seen, ['a commence', 'a finit', 'b commence', 'b finit', 'c'])
  await filesDone()
})

test('un travail raté rend son erreur à celui qui l’a demandé, et ne bloque pas les suivants', async () => {
  const bad = serial(async () => {
    throw new Error('disque plein')
  })
  const next = serial(async () => 'écrit')
  await assert.rejects(bad, /disque plein/)
  assert.equal(await next, 'écrit')
  await filesDone()
})

test('filesBusy() : vrai dès la demande, faux quand tout est fini, travail réussi ou raté', async () => {
  assert.equal(filesBusy(), false, 'rien n’attend au départ')
  const g1 = gate()
  const g2 = gate()
  const first = serial(() => g1.wait)
  const second = serial(async () => {
    await g2.wait
    throw new Error('raté')
  })
  assert.equal(filesBusy(), true, 'dès la demande, avant même que le travail commence')
  g1.open()
  await first
  await settle()
  assert.equal(filesBusy(), true, 'le premier a fini, le deuxième tourne encore')
  g2.open()
  await assert.rejects(second, /raté/)
  await filesDone()
  assert.equal(filesBusy(), false, 'un travail raté est compté comme fini')
})

test('filesDone() attend les travaux déjà demandés, même ratés, et ne rate jamais', async () => {
  const g = gate()
  let finished = 0
  const slow = serial(async () => {
    await g.wait
    finished++
  })
  const bad = serial(async () => {
    finished++
    throw new Error('raté')
  })
  // L'erreur revient à celui qui a demandé le travail : elle est attendue ici, pas par filesDone().
  const badSeen = assert.rejects(bad, /raté/)
  let done = false
  const waiting = filesDone().then(() => {
    done = true
  })
  await settle()
  assert.equal(done, false, 'le premier travail n’a pas fini')
  g.open()
  await waiting
  assert.equal(finished, 2, 'les deux travaux ont tourné avant la fin de l’attente')
  await slow
  await badSeen
})

test('filesDone() n’attend pas un travail demandé après elle', async () => {
  const g = gate()
  const waiting = filesDone()
  const later = serial(() => g.wait)
  let done = false
  void waiting.then(() => {
    done = true
  })
  await settle()
  assert.equal(done, true, 'l’attente prise avant la demande est déjà finie')
  assert.equal(filesBusy(), true, 'le travail demandé ensuite, lui, attend toujours sa porte')
  g.open()
  await later
  await filesDone()
  assert.equal(filesBusy(), false)
})

// Le dernier test : il laisse le compte de la file décalé, comme l'appli qui quitte (rien ne s'en sert après).
test('forgetFiles() : plus rien n’est compté, et le travail en cours finit quand même', async () => {
  const g = gate()
  const slow = serial(async () => {
    await g.wait
    return 'fini'
  })
  assert.equal(filesBusy(), true)
  forgetFiles()
  assert.equal(filesBusy(), false, 'l’appli peut quitter sans attendre')
  g.open()
  assert.equal(await slow, 'fini')
  await filesDone()
  // Tel qu'avant le déplacement (le test de l'appli était « !fileBusy ») : le travail oublié, en finissant, fait passer le
  // compte sous zéro, et la file se dit de nouveau occupée. Dans l'appli, forgetFiles() ne sert qu'au moment de quitter.
  assert.equal(filesBusy(), true)
})
