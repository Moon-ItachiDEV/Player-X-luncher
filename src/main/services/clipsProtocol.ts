import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { parseRange } from './clipsPlan'

// Protocole pxclip:// : la balise video et les vignettes de la page Clips lisent les fichiers par lui.


function notFound(): Response {
  return new Response('Introuvable', { status: 404 })
}

/** fetch() depuis les pages de l'appli (fichiers locaux, origine « null ») : personne d'autre. */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  return origin === 'null' || origin === 'file://' ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length' } : {}
}

/** Un fichier connu, avec de vraies réponses 206 : c'est ce qui permet l'avance rapide dans une balise video. */
async function serveFile(file: string, type: string, request: Request): Promise<Response> {
  const size = await stat(file).then((s) => (s.isFile() ? s.size : -1), () => -1)
  if (size < 0) return notFound()
  const base: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...corsHeaders(request) }
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
  const start = range ? range.start : 0
  const end = range ? range.end : size - 1
  const length = size === 0 ? 0 : end - start + 1
  const headers: Record<string, string> = { ...base, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) }
  const status = range ? 206 : 200
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ConstructorParameters<typeof Response>[0]
  return new Response(body, { status, headers })
}

/** Sert les vidéos et vignettes des clips connus, par leur identifiant seulement (jamais un chemin). */
export function registerClipProtocol(scheme: string, lookup: (id: string) => { video: string; thumb: string } | undefined, onError: (e: unknown) => void): void {
  protocol.handle(scheme, async (request) => {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET, HEAD' } })
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const c = lookup(url.pathname.replace(/^\//, ''))
      if (!c) return notFound()
      if (url.hostname === 'video') return await serveFile(c.video, 'video/mp4', request)
      if (url.hostname === 'thumb') return await serveFile(c.thumb, 'image/jpeg', request)
      return notFound()
    } catch (e) {
      onError(e)
      return new Response(null, { status: 500 })
    }
  })
}
