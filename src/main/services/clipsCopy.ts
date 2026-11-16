import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { app, clipboard, ClipboardItem } from 'electron'
import type { ClipShareResult, ClipShareStep } from '@shared/types'
import { broadcast } from '../windows'
import { shareSource } from './clipsFiles'
import { clipById, needClip } from './clipsIndex'
import { errText, log } from './clipsLog'
import { clipSettings } from './clipsSettings'
import { lightCopy } from './clipsShare'
import { DISCORD_MB, type ShareSource } from './sharePlan'

// Copier un clip : son fichier dans le presse-papiers, et « Copier pour Discord », qui y met le clip lui-même ou une copie
// plus légère. La copie légère se fabrique dans clipsShare.ts, selon les règles de sharePlan.ts ; ici, le choix de ce qui
// part dans le presse-papiers, et le presse-papiers lui-même. Ce code vient de clips.ts, sans changement de comportement.

// ---------- copier le fichier d'un clip ----------

/**
 * Presse-papiers de Windows : le fichier, à coller dans Discord ou l'Explorateur. Il faut un vrai CF_HDROP (c'est ce que lit
 * Chromium au collage) : Electron 44 n'a plus clipboard.writeBuffer et ne sait pas l'écrire, PowerShell si (Set-Clipboard
 * -LiteralPath, Windows PowerShell 5.1, livré avec Windows). Le chemin passe par une variable d'environnement, jamais dans la
 * commande. En secours, le format brut FileNameW suffit à l'Explorateur. Rien d'équivalent ailleurs que sous Windows.
 */
async function copyPath(file: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    // Essais en développement seulement (PX_CLIP_TEST_COPY=1) : le fichier est noté au lieu d'aller dans le presse-papiers.
    if (app.isPackaged || process.env.PX_CLIP_TEST_COPY !== '1') return false
    testCopied = file
    return true
  }
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Sta', '-Command', 'Set-Clipboard -LiteralPath $env:PX_CLIP_FILE'],
        { windowsHide: true, timeout: 15_000, env: { ...process.env, PX_CLIP_FILE: file } },
        (err) => (err ? reject(err) : resolve())
      )
    })
    return true
  } catch (e) {
    log(`Copie du fichier par PowerShell impossible : ${errText(e)}`)
  }
  try {
    await clipboard.write([new ClipboardItem({ FileNameW: new Blob([Buffer.from(`${file}\0`, 'ucs2')]) })])
    return true
  } catch (e) {
    log(`Copie du fichier impossible : ${errText(e)}`)
    return false
  }
}

/** Développement : le dernier fichier « copié » hors de Windows (PX_CLIP_TEST_COPY=1), pour les essais. */
let testCopied: string | null = null

/** Pour le relevé des essais (clips.ts) : le dernier fichier « copié » en développement, sinon rien. */
export const lastTestCopy = (): string | null => testCopied

/** Le fichier d'origine dans le presse-papiers, quel que soit son poids. */
export async function copyFile(id: unknown): Promise<boolean> {
  const c = clipById(id)
  return c ? copyPath(c.file) : false
}

// ---------- copier pour Discord (bêta 46) ----------

/**
 * La limite du compte Discord choisi dans les réglages. En développement seulement, PX_CLIP_TEST_SHARE_MB impose une limite
 * (en Mo, à virgule si besoin) : un petit clip d'essai peut alors demander une copie légère.
 */
function shareLimit(): { mb: number; bytes: number } {
  const dev = app.isPackaged ? Number.NaN : Number(process.env.PX_CLIP_TEST_SHARE_MB)
  const mb = dev > 0 && dev <= 500 ? dev : DISCORD_MB[clipSettings().discord]
  return { mb, bytes: Math.round(mb * 1_000_000) }
}

/**
 * « Copier pour Discord » : le fichier va dans le presse-papiers s'il passe sous la limite du compte ; sinon une copie plus
 * légère est fabriquée à côté (clipsShare.ts) et c'est elle qui est copiée. Le clip d'origine n'est jamais modifié. Un clip
 * trop long, ou une copie impossible, ne met rien dans le presse-papiers : la page le dit et propose l'original.
 */
export async function shareClip(id: unknown): Promise<ClipShareResult> {
  const c = needClip(id)
  const { mb: limitMb, bytes: limit } = shareLimit()
  const st = await stat(c.file).catch(() => null)
  if (!st?.isFile()) throw new Error('Le fichier de ce clip a disparu.')
  if (st.size <= limit) return (await copyPath(c.file)) ? { status: 'copied', sizeBytes: st.size, limitMb } : { status: 'failed' }
  let src: ShareSource
  try {
    src = await shareSource(c.file, st.size)
  } catch (e) {
    log(`Copie pour Discord du clip ${c.id} impossible : fichier illisible (${errText(e)}).`)
    return { status: 'unmade', limitMb, sizeBytes: st.size, reason: 'encode' }
  }
  const step = (percent: number): void => broadcast('clips:share', { id: c.id, percent } satisfies ClipShareStep)
  const made = await lightCopy({ id: c.id, file: c.file, mtimeMs: st.mtimeMs }, src, limit, step)
  if (made.kind === 'too-long') {
    log(`Copie pour Discord du clip ${c.id} : ${src.durationS.toFixed(1)} s, trop long pour ${limitMb} Mo (au plus ${made.maxS} s).`)
    return { status: 'too-long', limitMb, maxS: made.maxS, sizeBytes: st.size }
  }
  if (made.kind === 'unmade') return { status: 'unmade', limitMb, sizeBytes: st.size, reason: made.reason }
  if (made.kind === 'original') return (await copyPath(c.file)) ? { status: 'copied', sizeBytes: st.size, limitMb } : { status: 'failed' }
  if (!(await copyPath(made.file))) return { status: 'failed' }
  return { status: 'copied', sizeBytes: made.sizeBytes, limitMb, reduced: { width: made.width, height: made.height, fps: made.fps } }
}
