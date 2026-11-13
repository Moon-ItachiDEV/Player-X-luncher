import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'
import type { Account } from '@shared/types'
import { getSettings, saveAccount } from './settings'
import { getSteamProfiles } from './friends'

// Les logins passent par le navigateur du système (il y est souvent déjà connecté),
// puis reviennent sur un petit serveur local qui récupère la réponse.
const CALLBACK_PORT = 47823
const BASE = `http://127.0.0.1:${CALLBACK_PORT}`

let cancelPending: (() => void) | null = null

/** Annule la connexion en cours : ferme le serveur local et rejette l'attente. */
export function cancelLogin(): void {
  cancelPending?.()
}

/** Attend le retour du navigateur sur `path`. Seule une réponse qui porte le jeton de cette tentative (`accept`) est prise : les autres requêtes sont ignorées. */
function waitForCallback(path: string, accept: (url: URL) => boolean): Promise<URL> {
  cancelPending?.()
  return new Promise((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer)
      server.close()
      cancelPending = null
    }
    cancelPending = () => {
      done()
      reject(new Error('Connexion annulée.'))
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', BASE)
      if (url.pathname !== path || !accept(url)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<body style="background:#0c0a11;color:#f7f1f5;font-family:sans-serif;display:grid;place-items:center;height:100vh">' +
          '<h2>Connexion réussie, tu peux revenir sur Player X.</h2></body>'
      )
      done()
      resolve(url)
    })
    const timer = setTimeout(() => {
      done()
      reject(new Error('Connexion expirée, réessaie.'))
    }, 5 * 60_000)
    server.on('error', (e) => {
      done()
      reject(e)
    })
    server.listen(CALLBACK_PORT, '127.0.0.1')
  })
}

// ---------- Steam (OpenID 2.0) ----------

const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
/** Champs que Steam doit avoir signés pour que la réponse soit prise en compte. */
const STEAM_SIGNED = ['claimed_id', 'identity', 'return_to', 'response_nonce', 'op_endpoint']

export async function loginSteam(): Promise<Account> {
  // Jeton propre à cette tentative : une réponse préparée ailleurs (un autre compte Steam) n'est pas acceptée.
  const nonce = randomBytes(16).toString('hex')
  const returnTo = `${BASE}/steam/callback?n=${nonce}`
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': BASE,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  })
  const pending = waitForCallback('/steam/callback', (url) => url.searchParams.get('n') === nonce)
  await shell.openExternal(`${STEAM_OPENID}?${params}`)
  const cb = await pending
  const q = (k: string): string | null => cb.searchParams.get(`openid.${k}`)

  // La réponse doit venir de Steam, pour cette tentative, avec les champs importants signés.
  const signed = (q('signed') ?? '').split(',')
  if (q('mode') !== 'id_res' || q('op_endpoint') !== STEAM_OPENID || q('return_to') !== returnTo || !STEAM_SIGNED.every((f) => signed.includes(f)))
    throw new Error('Steam n’a pas validé la connexion.')

  // Vérifie la signature auprès de Steam pour ne pas faire confiance à l'URL de retour.
  const verify = new URLSearchParams()
  for (const [k, v] of cb.searchParams) if (k.startsWith('openid.')) verify.set(k, v)
  verify.set('openid.mode', 'check_authentication')
  const check = await fetch(STEAM_OPENID, { method: 'POST', body: verify, signal: AbortSignal.timeout(15_000) })
  if (!/^is_valid:true$/m.test(await check.text())) throw new Error('Steam n’a pas validé la connexion.')

  const claimed = q('claimed_id')
  const steamId = claimed?.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1]
  if (!steamId || q('identity') !== claimed) throw new Error('Identifiant Steam introuvable.')

  let account: Account = { platform: 'steam', id: steamId, name: `Steam ${steamId}` }
  const { steamApiKey } = getSettings()
  if (steamApiKey) {
    const [profile] = await getSteamProfiles(steamApiKey, [steamId]).catch(() => [])
    if (profile) account = { ...account, name: profile.personaname, avatarUrl: profile.avatarfull || undefined }
  }
  saveAccount(account)
  return account
}

// ---------- Discord (OAuth2) ----------

export async function loginDiscord(): Promise<Account> {
  const { discordClientId, discordClientSecret } = getSettings()
  if (!discordClientId || !discordClientSecret) {
    throw new Error('Renseigne le Client ID et le Client Secret Discord dans Paramètres.')
  }
  const redirectUri = `${BASE}/discord/callback`
  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: discordClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify',
    state
  })
  const pending = waitForCallback('/discord/callback', (url) => url.searchParams.get('state') === state)
  await shell.openExternal(`https://discord.com/oauth2/authorize?${params}`)
  const cb = await pending
  const code = cb.searchParams.get('code')
  if (!code) throw new Error(cb.searchParams.get('error_description') ?? 'Connexion Discord annulée.')

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: discordClientId,
      client_secret: discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }),
    // Discord peut ne jamais répondre : sans limite, la connexion restait bloquée et impossible à annuler
    signal: AbortSignal.timeout(15_000)
  })
  if (!tokenRes.ok) throw new Error(`Discord a refusé le code (${tokenRes.status}).`)
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) })
  const me = (await meRes.json()) as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown }
  const id = typeof me.id === 'string' && /^\d{15,22}$/.test(me.id) ? me.id : null
  const name = [me.global_name, me.username].find((n): n is string => typeof n === 'string' && !!n)
  if (!meRes.ok || !id || !name) throw new Error('Profil Discord illisible, réessaie.')
  const account: Account = {
    platform: 'discord',
    id,
    name: name.slice(0, 128),
    avatarUrl: typeof me.avatar === 'string' && /^(a_)?[0-9a-f]{32}$/.test(me.avatar) ? `https://cdn.discordapp.com/avatars/${id}/${me.avatar}.png?size=128` : undefined
  }
  saveAccount(account)
  return account
}
