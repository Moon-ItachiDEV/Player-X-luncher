import type { EditEncoder, EditEncoderResult, EditEngineTest, EditLastFilm } from '@shared/types'
import { pixelFormat, videoArgs } from './editCompile'

// Règles du moteur vidéo, sans Electron ni fichier (testées par editEngineRules.test.ts) : lire ce que ffmpeg répond,
// écrire ses arguments, choisir l'encodeur, relire un essai enregistré, écrire le texte à copier.

/** Ordre de préférence : la carte graphique d'abord (NVIDIA, AMD, Intel), puis l'encodeur de Windows, puis le secours sans carte. */
export const ENCODERS: readonly EditEncoder[] = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libopenh264']

/**
 * Le film d'essai de chaque encodeur : 5 s d'une mire en 1080p à 60 images/s, avec les réglages d'image d'un vrai film. Il dit
 * si l'encodeur marche sur ce PC ; trop court et trop simple pour dire une vitesse (le démarrage pèse plus que le travail).
 */
export const SAMPLE = { seconds: 5, width: 1920, height: 1080, fps: 60 } as const
/** L'essai sur le dernier clip : ses premières secondes, par le chemin d'un vrai film (un plan, puis l'assemblage). Lui dit la vitesse. */
export const CLIP_SAMPLE_S = 20

/** Un nom d'encodeur de ffmpeg : rien d'autre ne passe dans la ligne de commande. */
const ENCODER_NAME = /^[a-z0-9_]{3,24}$/
const MAX_ERROR = 300

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** « 9.0.2 » dans « ffmpeg version n9.0.2-39-g7adfbe40dc-20261031 Copyright… » ; '' si ce n'est pas la réponse de ffmpeg. */
export function parseVersion(out: string): string {
  const m = /^ffmpeg version n?(\d+(?:\.\d+){1,3})/m.exec(out)
  return m ? m[1] : ''
}

/** Les encodeurs voulus que cite « ffmpeg -encoders », dans l'ordre de préférence. Cité ne veut pas dire utilisable : seul l'essai le dit. */
export function parseEncoders(out: string, wanted: readonly string[] = ENCODERS): string[] {
  const seen = new Set<string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*V[\w.]{5}\s+([a-z0-9_]+)\s/.exec(line)
    if (m) seen.add(m[1])
  }
  return wanted.filter((e) => seen.has(e))
}

function checked(encoder: string): string {
  if (!ENCODER_NAME.test(encoder)) throw new Error('Encodeur inconnu.')
  return encoder
}

const HEAD = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y']

/** Arguments de l'essai d'un encodeur : une mire fabriquée par ffmpeg lui-même (rien à lire sur le disque), écrite dans `outFile`. */
export function sampleArgs(encoder: string, outFile: string): string[] {
  const e = checked(encoder)
  return [
    ...HEAD,
    '-f', 'lavfi', '-i', `testsrc2=size=${SAMPLE.width}x${SAMPLE.height}:rate=${SAMPLE.fps}`,
    '-t', String(SAMPLE.seconds),
    '-vf', `format=${pixelFormat(e)}`,
    ...videoArgs(e, SAMPLE.fps),
    '-an', '-f', 'mp4', `file:${outFile}`
  ]
}

/** Celui que Player X utilisera : le premier qui marche dans l'ordre de préférence (la carte graphique avant tout). */
export function pickBest(results: readonly EditEncoderResult[]): string | null {
  const ok = results.filter((r) => r.ok)
  for (const e of ENCODERS) if (ok.some((r) => r.id === e)) return e
  return ok[0]?.id ?? null
}

/**
 * Les encodeurs à essayer pour fabriquer un film, dans l'ordre : celui qui a fabriqué le film précédent (`last`), puis ceux
 * que le dernier essai a vus marcher (le choisi en tête), puis les autres en dernier recours (un pilote a pu changer depuis
 * l'essai). Sans essai : tous, dans l'ordre de préférence. `extra` : l'encodeur du développement, en tête.
 */
export function encoderOrder(test: EditEngineTest | null, last?: string | null, extra?: string | null): string[] {
  const worked = new Set((test?.encoders ?? []).filter((e) => e.ok).map((e) => e.id))
  const known = (e: string): boolean => (ENCODERS as readonly string[]).includes(e) || e === extra
  const out: string[] = []
  for (const e of [extra, last, test?.best, ...ENCODERS.filter((x) => worked.has(x)), ...ENCODERS]) {
    if (typeof e === 'string' && ENCODER_NAME.test(e) && known(e) && !out.includes(e)) out.push(e)
  }
  return out
}

/** Secondes qu'il faudrait pour fabriquer une minute de film, d'après un essai de `sampleS` secondes fait en `seconds`. */
export function minuteSeconds(seconds: number, sampleS: number): number {
  return sampleS > 0 ? (seconds * 60) / sampleS : 0
}

/**
 * Un message de ffmpeg sans rien qui dise où sont les fichiers de ce PC : les chemins donnés (dossier d'essai, clip), puis tout
 * dossier de session (« C:\Users\prénom », « /home/prénom »). Une ligne, 300 caractères au plus.
 */
export function scrub(text: string, hide: readonly string[] = []): string {
  let s = String(text)
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const h of [...hide].filter((x) => typeof x === 'string' && x.length >= 3).sort((a, b) => b.length - a.length)) {
    for (const v of new Set([h, h.replace(/\\/g, '/'), h.replace(/\//g, '\\')])) s = s.replace(new RegExp(esc(v), 'gi'), '…')
  }
  // Un nom de session peut contenir des espaces : tout part jusqu'au séparateur suivant.
  s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"':\r\n]+/gi, '$1…').replace(/(\/(?:home|Users)\/)[^/"':\r\n]+/g, '$1…')
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > MAX_ERROR ? `${s.slice(0, MAX_ERROR - 1)}…` : s
}

function cleanResult(raw: unknown): EditEncoderResult | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || typeof r.id !== 'string' || !ENCODER_NAME.test(r.id) || typeof r.ok !== 'boolean') return null
  if (r.ok) return num(r.seconds) && r.seconds > 0 && r.seconds < 3600 ? { id: r.id, ok: true, seconds: r.seconds } : null
  return { id: r.id, ok: false, ...(typeof r.error === 'string' && r.error ? { error: scrub(r.error) } : {}) }
}

/**
 * Un essai relu dans la base : structure vérifiée, rien d'inconnu gardé. null s'il ne vaut rien, ou s'il vient d'une autre
 * version du moteur (l'essai est à refaire).
 */
export function cleanTest(raw: unknown, version: string): EditEngineTest | null {
  const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!t || !version || t.version !== version || !num(t.at) || t.at <= 0 || !num(t.sampleS) || t.sampleS <= 0 || !Array.isArray(t.encoders)) return null
  const encoders = t.encoders.slice(0, 8).map(cleanResult).filter((r): r is EditEncoderResult => r !== null)
  if (!encoders.length) return null
  const best = typeof t.best === 'string' && encoders.some((e) => e.id === t.best && e.ok) ? t.best : null
  const c = t.clip && typeof t.clip === 'object' ? (t.clip as Record<string, unknown>) : null
  const dims = c && num(c.sampleS) && c.sampleS > 0 && num(c.width) && num(c.height) && c.width > 0 && c.height > 0
  const clip =
    c && dims && typeof c.ok === 'boolean' && (!c.ok || (num(c.seconds) && c.seconds > 0))
      ? {
          ok: c.ok,
          ...(c.ok ? { seconds: c.seconds as number } : {}),
          sampleS: c.sampleS as number,
          width: c.width as number,
          height: c.height as number,
          ...(typeof c.audio === 'boolean' ? { audio: c.audio } : {}),
          ...(!c.ok && typeof c.error === 'string' && c.error ? { error: scrub(c.error) } : {})
        }
      : null
  return { at: t.at, version, sampleS: t.sampleS, encoders, best, ...(clip ? { clip } : {}) }
}

const two = (n: number): string => String(n).padStart(2, '0')
const fr = (n: number, digits = 2): string => n.toFixed(digits).replace('.', ',')
const speed = (seconds: number, sampleS: number): string => `×${fr(sampleS / seconds, 1)}`

/** Le dernier film fabriqué, relu dans la base : structure vérifiée. null s'il ne vaut rien. */
export function cleanLastFilm(raw: unknown): EditLastFilm | null {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!f || !num(f.at) || f.at <= 0 || !num(f.shots) || f.shots < 1 || !num(f.durationS) || f.durationS <= 0 || !num(f.seconds) || f.seconds <= 0) return null
  if (typeof f.encoder !== 'string' || !ENCODER_NAME.test(f.encoder)) return null
  return { at: f.at, shots: Math.round(f.shots), durationS: f.durationS, seconds: f.seconds, encoder: f.encoder }
}

const VENDORS: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }
/** Les cartes de Microsoft sont des pilotes logiciels (« Basic Render Driver »), pas des cartes : elles ne disent rien du PC. */
const SOFTWARE_VENDOR = 0x1414
const hex4 = (n: number): string => n.toString(16).padStart(4, '0')

/** Les cartes graphiques du PC en une ligne : marque et numéro de modèle, sans les pilotes logiciels de Windows. */
export function gpuText(devices: readonly { vendorId?: unknown; deviceId?: unknown }[]): string {
  const list = devices
    .filter((d): d is { vendorId: number; deviceId: number } => num(d?.vendorId) && num(d?.deviceId) && d.vendorId > 0 && d.vendorId !== SOFTWARE_VENDOR)
    .map((d) => `${VENDORS[d.vendorId] ?? hex4(d.vendorId)} ${hex4(d.deviceId)}`)
  return [...new Set(list)].join(', ') || 'aucune reconnue'
}

/**
 * Le dernier essai en texte, pour l'envoyer : ce que chaque encodeur a donné (il marche ou non : la mire ne dit pas de
 * vitesse), celui qui est choisi, l'essai sur le dernier clip (lui dit la vitesse), et le dernier film fabriqué s'il y en a
 * un. `ctx` : la version de l'appli, le build du moteur et une ligne sur le PC. Aucun chemin, aucun nom.
 */
export function reportText(t: EditEngineTest, ctx: { app: string; build: string; system: string }, lastFilm?: EditLastFilm | null): string {
  const d = new Date(t.at)
  const when = `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} à ${two(d.getHours())} h ${two(d.getMinutes())}`
  const lines = [
    `Player X V3 Test ${ctx.app} : essai du moteur vidéo du ${when}`,
    `Moteur : FFmpeg ${t.version} (${ctx.build})`,
    `PC : ${ctx.system}`,
    `Mire d'essai : ${SAMPLE.width} × ${SAMPLE.height}, ${SAMPLE.fps} images/s, ${t.sampleS} s`,
    ...t.encoders.map((e) => `- ${e.id} : ${e.ok && e.seconds ? `marche (${fr(e.seconds)} s)` : `non${e.error ? ` (${e.error})` : ''}`}`),
    `Choisi : ${t.best ?? 'aucun'}`
  ]
  if (t.clip) {
    const c = t.clip
    const what = `${c.width} × ${c.height}${c.audio === undefined ? '' : c.audio ? ', avec le son' : ', sans le son'}`
    lines.push(`Dernier clip (${what}) : ${c.ok && c.seconds ? `${fr(c.sampleS, 1)} s de film en ${fr(c.seconds)} s (${speed(c.seconds, c.sampleS)})` : `non${c.error ? ` (${c.error})` : ''}`}`)
  } else lines.push('Dernier clip : aucun clip sur ce PC')
  if (lastFilm) lines.push(`Dernier film : ${lastFilm.shots} plan${lastFilm.shots > 1 ? 's' : ''}, ${fr(lastFilm.durationS, 1)} s, fabriqué en ${fr(lastFilm.seconds, 1)} s avec ${lastFilm.encoder} (${speed(lastFilm.seconds, lastFilm.durationS)})`)
  return lines.join('\n')
}

/** Un essai raté pendant la fabrication d'un film : l'encodeur, l'étape (« plan 3 sur 12 », « assemblage »), ce que le moteur a répondu. */
export interface FilmAttempt {
  encoder: string
  step: string
  error: string
}

/**
 * Un film raté en texte, pour l'envoyer : le film demandé et chaque essai raté, dans l'ordre. Les messages du moteur sont
 * déjà passés par scrub : aucun chemin, aucun nom. Douze essais au plus (deux par encodeur, et l'assemblage).
 */
export function filmReportText(
  film: { at: number; shots: number; durationS: number; width: number; height: number; fps: number },
  attempts: readonly FilmAttempt[],
  ctx: { app: string; version: string; build: string; system: string }
): string {
  const d = new Date(film.at)
  const when = `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} à ${two(d.getHours())} h ${two(d.getMinutes())}`
  return [
    `Player X V3 Test ${ctx.app} : film raté le ${when}`,
    `Moteur : FFmpeg ${ctx.version} (${ctx.build})`,
    `PC : ${ctx.system}`,
    `Film : ${film.shots} plan${film.shots > 1 ? 's' : ''}, ${fr(film.durationS, 1)} s, ${film.width} × ${film.height} à ${film.fps} images/s`,
    ...attempts.slice(0, 12).map((a) => `- ${a.encoder}, ${a.step} : ${scrub(a.error) || 'pas de message'}`),
    ...(attempts.length ? [] : ['- aucun détail'])
  ].join('\n')
}
