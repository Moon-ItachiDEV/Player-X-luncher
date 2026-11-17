// Overlay CS2, trois styles à l'essai (0.6.2-beta.1) : Étendard, Viseur, Régie. Repris de la maquette « Overlay CS2 ·
// trois pistes » (v3), avec les vraies infos du match (Cs2Live, Cs2Recap). Chaque pièce est une chaîne HTML : overlay.ts la
// pose d'un coup quand le moment change (les entrées s'animent), puis la remplace sans animation tant que le moment reste
// le même (argent pendant les achats, compte à rebours du bilan, mort en plein round). Styles : trois.css.
import { formatKd, killDeath, mapLabel, modeLabel, RESULT_LABEL } from '@shared/cs2'
import type { Cs2Live, Cs2Recap, Cs2Round, Cs2Side } from '@shared/types'
import { buyAdvice, FORCE_MIN, FULL_BUY, lossBonusMin } from './view'

export type ThreeStyle = 'etendard' | 'viseur' | 'regie'
export const THREE: Record<ThreeStyle, string> = { etendard: 'te', viseur: 'tv', regie: 'tr' }
export const isThree = (s: string): s is ThreeStyle => s === 'etendard' || s === 'viseur' || s === 'regie'

/** Ce que overlay.ts sait en plus du match : l'argent du début des achats, un multi-kill tout frais, le compte à rebours. */
export interface Extra {
  /** Argent au début du temps d'achat (le conseil ne change pas pendant que tu achètes). */
  budget?: number
  /** Le round vient de passer à 3 élim. ou plus (2,6 s) : la Régie lance son gros bandeau. */
  fresh: boolean
  /** Secondes avant que le bilan se replie. */
  endLeft: number
}

export type Piece = { kind: 'buy' | 'pill' | 'half'; live: Cs2Live } | { kind: 'end'; recap: Cs2Recap }

// ---------- petits outils ----------

const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const NB = ' '
const money = (n: number): string => `${int.format(n)}${NB}$`
const esc = (v: string | number): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const two = (n: number): string => String(n).padStart(2, '0')
const other = (side: Cs2Side): Cs2Side => (side === 'CT' ? 'T' : 'CT')
const sideCls = (side?: Cs2Side): string => (side === 'CT' ? 'ct' : side === 'T' ? 'tt' : '')
const kda = (l: { kills: number; deaths: number; assists: number }): string => `${l.kills}/${l.deaths}/${l.assists}`
const pct = (n?: number): string => (n === undefined ? '–' : `${n}${NB}%`)
const adrOf = (l: Cs2Live): string => (l.adr === undefined ? '–' : String(l.adr))
const won = (r: Cs2Round): boolean | undefined => (r.side ? r.winner === r.side : undefined)
const MULTI: Record<number, [string, string]> = { 3: ['Triplé', 'TRIPLÉ'], 4: ['Quadruplé', 'QUADRUPLÉ'], 5: ['Ace', 'ACE'] }
const multiName = (k: number): [string, string] | undefined => MULTI[Math.min(5, k)]
const plural = (n: number, one: string, many: string): string => `${n}${NB}${n > 1 ? many : one}`

/** Les rounds de la mi-temps en cours (douze au plus) : la frise ne déborde jamais. */
function halfRounds(rounds: Cs2Round[], round: number): Cs2Round[] {
  const start = round > 24 ? 25 : round > 12 ? 13 : 1
  return rounds.filter((r) => r.n >= start).slice(-12)
}
/** Premier round joué dans l'autre camp (marqué d'un petit écart dans les frises). */
function swapAt(rounds: Cs2Round[]): number {
  for (let i = 1; i < rounds.length; i++) if (rounds[i - 1].side && rounds[i].side && rounds[i - 1].side !== rounds[i].side) return rounds[i].n
  return -1
}

/** Mi-temps : CS2 peut déjà donner le camp de la suite. Le camp joué est celui du dernier round ; le score suit. */
function halfInfo(live: Cs2Live): { played?: Cs2Side; sc?: { us: number; them: number }; lead: string } {
  const played = live.rounds.at(-1)?.side ?? live.side
  const flipped = !!played && !!live.side && played !== live.side
  const sc = live.score && flipped ? { us: live.score.them, them: live.score.us } : live.score
  const lead = !sc ? 'Mi-temps' : sc.us > sc.them ? 'Devant' : sc.us < sc.them ? 'Derrière' : 'À égalité'
  return { played, sc, lead }
}

/** Argent, conseil d'achat et « même en perdant » : seulement ce que les chiffres du match permettent de dire. */
function eco(live: Cs2Live, budget?: number) {
  const side = live.side
  const cash = live.money
  const base = budget ?? cash
  const adv = side && base !== undefined ? buyAdvice(base, side) : undefined
  const bonus = cash !== undefined ? lossBonusMin(live.rounds, live.round) : null
  const next = bonus !== null && cash !== undefined ? cash + bonus : undefined
  const nextAdv = next !== undefined && side ? buyAdvice(next, side) : undefined
  return { side, cash, adv, next, nextAdv }
}

function bestLine(r: Cs2Recap): string {
  return r.best ? `round ${r.best.n}, ${plural(r.best.kills, 'élim.', 'élim.')}` : ''
}
const recapAdr = (r: Cs2Recap): string => (r.hasRounds && r.roundsTracked > 0 ? int.format(r.damage / r.roundsTracked) : '–')
const recapHs = (r: Cs2Recap): string => (r.trackedKills > 0 ? pct(Math.round((r.headshots / r.trackedKills) * 100)) : '–')
const multiText = (r: Cs2Recap): string =>
  [r.multi.k3 && `${r.multi.k3}${NB}×${NB}3K`, r.multi.k4 && `${r.multi.k4}${NB}×${NB}4K`, r.multi.k5 && `${r.multi.k5}${NB}ace`].filter(Boolean).join(' · ')

// ---------- le vrai logo de Player X ----------

let LID = 0
/**
 * Le logo complet (LOGO_FULL de v3ui/constants.js, mêmes formes, mêmes couleurs), recadré sur l'écu. Avec `k` (0 à 5),
 * ses propres pièces comptent tes élim. du round : 1re = chevron du bas, 2e = chevron du haut, 3e = le losange,
 * 4e = la barre à moitié, 5e (ace) = la barre pleine et le point d'enregistrement. `flash` : un éclair rouge sur l'écu.
 */
export function logo(k = -1, flash = false): string {
  const i = `ov3lg${++LID}`
  const on = (n: number): boolean => k >= n
  const glow = (pts: string, w: number, n: number): string =>
    on(n) ? `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${w + 4}" opacity=".9" filter="url(#${i}g)"/><polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${w}"/>` : ''
  return `<svg viewBox="300 255 424 497" aria-hidden="true"><defs><linearGradient id="${i}b" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e8264f"/><stop offset="1" stop-color="#c4123a"/></linearGradient><path id="${i}e" d="M60 7 L104 22 V58 C104 84 86 101 60 113 C34 101 16 84 16 58 V22 Z"/><filter id="${i}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter><filter id="${i}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>
<g transform="translate(512 504) scale(4.1) translate(-60 -60)">
<use href="#${i}e" fill="none" stroke="#c4123a" stroke-width="10" opacity=".55" filter="url(#${i}g)"/><use href="#${i}e" fill="none" stroke="#e8264f" stroke-width="5" opacity=".5" filter="url(#${i}s)"/>
<use href="#${i}e" fill="#140709"/><path d="M60 18 L94 30 V40" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
${flash ? `<use class="lg-blink" href="#${i}e" fill="#e8264f"/>` : ''}
<polyline points="36,80 60,58 84,80" fill="none" stroke="url(#${i}b)" stroke-width="11" stroke-linejoin="miter"/><polyline points="40,56 60,38 80,56" fill="none" stroke="url(#${i}b)" stroke-width="9" stroke-opacity="0.7" stroke-linejoin="miter"/>
${glow('36,80 60,58 84,80', 11, 1)}${glow('40,56 60,38 80,56', 9, 2)}
${on(3) ? `<circle cx="60" cy="28" r="9" fill="#fff" filter="url(#${i}s)"/><polygon points="60,20 66,30 60,36 54,30" fill="#fff"/>` : '<polygon points="60,22 64,30 60,34 56,30" fill="#ffffff"/>'}
${k >= 0 ? '<rect x="42" y="91" width="36" height="2.6" rx="1.3" fill="#fff" opacity=".18"/>' : ''}${on(4) ? `<rect x="42" y="91" width="${on(5) ? 36 : 18}" height="2.6" rx="1.3" fill="#fff"/>` : ''}${on(5) ? '<circle cx="82" cy="44" r="3.4" fill="#fff"/>' : ''}
<use href="#${i}e" fill="none" stroke="url(#${i}b)" stroke-width="6" stroke-linejoin="round"/></g></svg>`
}

// ---------- Viseur : des lignes et des crochets accrochés au HUD, sans fond ----------

const vBr = '<i class="br tl"></i><i class="br brr"></i>'
const vPips = (k: number): string => `<div class="pips">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= k ? 'on' : ''}${n === Math.min(5, k) ? ' new' : ''}"></i>`).join('')}</div>`
function vTicks(rs: Cs2Round[], next: boolean): string {
  const sw = swapAt(rs)
  return `<div class="ticks">${rs
    .map((r) => {
      const w = won(r)
      return `<i class="${w ? 'w' : ''}${r.n === sw ? ' sw' : ''}" style="height:${w ? 46 : w === false ? 20 : 30}px"></i>`
    })
    .join('')}${next ? '<i class="nx"></i>' : ''}</div>`
}
function vKills(rs: Cs2Round[], w = 14, gap?: number): string {
  const sw = swapAt(rs)
  return `<div class="kn"${gap !== undefined ? ` style="height:100px;gap:${gap}px;margin-top:60px"` : ''}>${rs
    .map((r) => `<div${r.n === sw ? ' style="margin-left:14px"' : ''}><span>${r.kills ?? '–'}</span><i class="${won(r) ? 'w' : ''}" style="width:${w}px;height:${10 + (r.kills ?? 0) * 12}px"></i></div>`)
    .join('')}</div>`
}

const viseur = {
  buy(live: Cs2Live, x: Extra): string {
    const e = eco(live, x.budget)
    const sc = live.score && e.side
    const full = e.side ? FULL_BUY[e.side] : 4300
    const bar = (n: number): number => Math.min(100, (n / 6000) * 100)
    return `<div class="blk in" style="left:24px;top:calc(340px * var(--p,1));width:470px">${vBr}
<div style="display:flex;align-items:center;gap:10px"><span class="mark">${logo()}</span><div class="k"><b>R${two(live.round)}</b> · ACHAT · ${esc(mapLabel(live.map).toUpperCase())}</div></div>
${sc ? `<div class="score"><span class="${sideCls(e.side)}">${two(live.score!.us)}</span><span class="dash"></span><span class="${sideCls(other(e.side!))}">${two(live.score!.them)}</span><small>${e.side} · ${other(e.side!)}</small></div>` : ''}
${vTicks(halfRounds(live.rounds, live.round), true)}
${e.cash !== undefined ? `<div class="money"><small>$</small>${esc(int.format(e.cash))}</div><div class="budget"><i style="width:${bar(e.cash)}%"></i><em style="left:${bar(FORCE_MIN)}%"><span>FORCE</span></em><em style="left:${bar(full)}%"><span>COMPLET</span></em></div>` : ''}
${e.adv ? `<div class="adv"><b>›</b> ${esc(e.adv.title.toUpperCase())} · ${esc(e.adv.detail)}</div>` : ''}
${e.next !== undefined ? `<div class="nxt">R${two(live.round + 1)} SI PERDU : ≥${NB}${esc(money(e.next))}${e.nextAdv ? ` · ${esc(e.nextAdv.title.toUpperCase())}` : ''}</div>` : ''}
<div class="stats"><div><span>K/D/A</span>${kda(live)}</div><div><span>ADR</span>${adrOf(live)}</div><div><span>HS</span>${pct(live.hsPct)}</div></div></div>`
  },
  pill(live: Cs2Live): string {
    const k = live.roundKills
    const m = multiName(k)
    return `<div class="blk in" style="right:30px;bottom:calc(96px * var(--p,1));display:flex;align-items:center;gap:22px">${vBr}${m ? '<i class="scan"></i>' : ''}
${m ? `<div class="flash">${k >= 5 ? '<b>ACE</b>' : `<b>${k}</b>K`}</div>` : ''}<span class="mark" style="width:52px;height:61px">${logo(k, !!m)}</span><div><div class="k" style="margin-bottom:8px"><b>R${two(live.round)}</b> · ${m ? m[1] : 'ÉLIM.'}</div>${vPips(k)}</div><div class="kda">${kda(live)}</div></div>`
  },
  half(live: Cs2Live): string {
    const { played, sc, lead } = halfInfo(live)
    return `<div class="blk in" style="left:50%;top:calc(118px * var(--p,1));translate:-50% 0;display:grid;justify-items:center;gap:16px">
<div class="band"><span>MI-TEMPS</span>${sc ? `<span class="${sideCls(played)}">${two(sc.us)}</span><span style="opacity:.6">–</span><span class="${played ? sideCls(other(played)) : ''}">${two(sc.them)}</span>` : ''}<span style="color:var(--a)">${esc(lead.toUpperCase())}</span></div>
${live.rounds.length ? vKills(halfRounds(live.rounds, live.rounds.at(-1)!.n)) : ''}
<div class="k" style="font-size:19px">${played ? `TU PASSES <b class="${sideCls(other(played))}">${other(played)}</b> · ` : ''}K/D/A ${kda(live)} · K/D ${formatKd(killDeath(live))} · ADR ${adrOf(live)} · HS ${pct(live.hsPct)}</div></div>`
  },
  end(r: Cs2Recap, x: Extra): string {
    const label = RESULT_LABEL[r.result].toUpperCase()
    const rows: [string, string][] = [
      ['K/D', formatKd(killDeath(r))],
      ['K/D/A', kda(r)],
      ['ADR', recapAdr(r)],
      ['HS', recapHs(r)]
    ]
    if (r.best) rows.push(['MEILLEUR ROUND', `R${r.best.n} · ${r.best.kills}${NB}ÉLIM.`])
    const mt = multiText(r)
    if (mt) rows.push(['MULTI', mt])
    rows.push(['MVP', String(r.mvps)])
    const big = `<b>${esc(label.slice(0, 3))}</b>${esc(label.slice(3))}`
    return `<div class="vig"></div><div class="blk in" style="left:50%;translate:-50% 0;top:calc(190px * var(--p,1));width:1260px;min-height:640px;padding:60px 70px">
<i class="br tl" style="width:60px;height:60px"></i><i class="br tr" style="width:60px;height:60px"></i><i class="br bl" style="width:60px;height:60px"></i><i class="br brr" style="width:60px;height:60px"></i>
<div style="display:flex;align-items:center;gap:14px"><span class="mark" style="width:44px;height:52px">${logo()}</span><div class="k" style="font-size:20px"><b>FIN DU MATCH</b> · ${esc(modeLabel(r.mode).toUpperCase())}${r.sample ? ' · EXEMPLE' : ''} · SE FERME DANS ${x.endLeft}${NB}S</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:30px;align-items:start">
<div><div class="big">${big}</div><div class="k" style="font-size:24px;margin-top:18px">${esc(mapLabel(r.map).toUpperCase())}${r.score && r.result !== 'left' ? ` · <span style="color:#fff">${two(r.score.us)} – ${two(r.score.them)}</span>` : ''}</div>
${r.rounds.length ? `${vKills(r.rounds.slice(-30), 12, 5)}<div class="k" style="margin-top:10px">TES ÉLIM. PAR ROUND · <b>ROUGE</b> = ROUND GAGNÉ</div>` : ''}</div>
<dl class="rd">${rows.map(([k, v], i) => `<dt style="--i:${i * 2}">${esc(k)}</dt><dd style="--i:${i * 2 + 1}">${esc(v)}</dd>`).join('')}</dl>
</div></div>`
  }
}

// ---------- Étendard : le blason reste au même endroit et hisse des oriflammes ----------
// 0.6.2 refait : plus de grande bannière verticale. Les infos sortent de derrière le blason en bandes horizontales
// (queue d'aronde à gauche), la plus importante en rouge en haut, les détails en bandes fines dessous.

const kPips = (k: number): string => `<div class="kp">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= k ? 'on' : ''}${n === Math.min(5, k) ? ' new' : ''}"></i>`).join('')}</div>`
function eRounds(rs: Cs2Round[], next: boolean): string {
  const sw = swapAt(rs)
  return `<div class="rr">${rs.map((r) => `<i class="${won(r) ? 'w' : ''}${r.n === sw ? ' sw' : ''}"></i>`).join('')}${next ? '<i class="nx"></i>' : ''}</div>`
}
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z" fill="#fff"/></svg>'
const CHEV = '<svg viewBox="0 0 24 24"><path d="M3 18l9-9 9 9" fill="none" stroke="#e8264f" stroke-width="4"/></svg>'
/** Une oriflamme ; `cls` : r (rouge, l'info principale) ou th (bande fine). */
const fl = (i: number, body: string, cls = ''): string => `<div class="fl${cls ? ` ${cls}` : ''}" style="--i:${i}">${cls === 'th' ? `<span>${body}</span>` : body}</div>`
/** Le blason et, dessous, les losanges des élim. du round (seulement en plein round). */
const hold = (shield: string, pips = '', pulse = false): string => `<div class="hold"><div class="shield${pulse ? ' pulse' : ''}">${shield}</div>${pips}</div>`
const ens = (flags: string[], h: string): string => `<div class="ens"><div class="fls">${flags.filter(Boolean).join('')}</div>${h}</div>`

const etendard = {
  buy(live: Cs2Live, x: Extra): string {
    const e = eco(live, x.budget)
    const sc = live.score && e.side
    const flags = [
      fl(
        0,
        `<div class="col"><span class="ey">Round ${live.round} · achat</span>${eRounds(halfRounds(live.rounds, live.round), true)}</div>${
          sc ? `<div class="sc"><small>${e.side}</small>${live.score!.us}<span class="d">–</span><span class="them">${live.score!.them}</span><small>${other(e.side!)}</small></div>` : ''
        }`,
        'r'
      ),
      e.cash !== undefined ? fl(1, `<span class="mny">${esc(money(e.cash))}</span>${e.adv ? `<span class="adv"><b>${esc(e.adv.title)}</b>${esc(e.adv.detail)}</span>` : ''}`) : '',
      e.next !== undefined ? fl(2, `Si perdu : au moins <b>${esc(money(e.next))}</b> au round ${live.round + 1}${e.nextAdv ? ` · ${esc(e.nextAdv.title.toLowerCase())}` : ''}`, 'th') : '',
      fl(3, `K/D/A <b>${kda(live)}</b> · ADR <b>${adrOf(live)}</b> · HS <b>${pct(live.hsPct)}</b>`, 'th')
    ]
    return ens(flags, hold(logo(0)))
  },
  pill(live: Cs2Live): string {
    const k = live.roundKills
    const m = multiName(k)
    const flag = m
      ? fl(0, `<span class="word">${m[0]}</span><span class="kt"><small>Round ${live.round}</small><b>${k}${NB}élim.</b></span>`, 'r')
      : fl(0, `<span class="kt"><small>Round ${live.round} · ${kda(live)}</small><b>${k}${NB}élim.</b></span>`)
    return ens([flag], hold(logo(k, !!m), kPips(k), !!m))
  },
  half(live: Cs2Live): string {
    const { played, sc, lead } = halfInfo(live)
    const flags = [
      fl(0, `<div class="col"><span class="ey">${esc(mapLabel(live.map))} · mi-temps</span><span class="word">${esc(lead)}</span></div>${sc ? `<div class="sc">${sc.us}<span class="d">–</span><span class="them">${sc.them}</span></div>` : ''}`, 'r'),
      live.rounds.length || played
        ? fl(1, `${live.rounds.length ? eRounds(halfRounds(live.rounds, live.rounds.at(-1)!.n), false) : ''}${played ? `<span class="ln">Tu passes <b class="${sideCls(other(played))}">${other(played)}</b> pour la suite</span>` : ''}`)
        : '',
      fl(2, `<div class="st"><div><span>K/D/A</span><b>${kda(live)}</b></div><div><span>K/D</span><b>${formatKd(killDeath(live))}</b></div><div><span>ADR</span><b>${adrOf(live)}</b></div><div><span>HS</span><b>${pct(live.hsPct)}</b></div></div>`)
    ]
    return ens(flags, hold(logo()))
  },
  end(r: Cs2Recap, x: Extra): string {
    const palm: string[] = []
    if (r.mvps > 0) palm.push(`<span>${STAR.repeat(Math.min(5, r.mvps))} ${plural(r.mvps, 'MVP', 'MVP')}</span>`)
    if (r.multi.k3) palm.push(`<span>${CHEV.repeat(3)} ${plural(r.multi.k3, 'triplé', 'triplés')}</span>`)
    if (r.multi.k4) palm.push(`<span>${CHEV.repeat(4)} ${plural(r.multi.k4, 'quadruplé', 'quadruplés')}</span>`)
    if (r.multi.k5) palm.push(`<span>${CHEV.repeat(5)} ${plural(r.multi.k5, 'ace', 'aces')}</span>`)
    const flags = [
      fl(
        0,
        `<div class="col"><span class="ey">${esc(mapLabel(r.map))} · ${esc(modeLabel(r.mode))}${r.sample ? ' · exemple' : ''}</span><span class="word l">${esc(RESULT_LABEL[r.result])}</span></div>${
          r.score && r.result !== 'left' ? `<div class="sc">${r.score.us}<span class="d">–</span><span class="them">${r.score.them}</span></div>` : ''
        }`,
        'r'
      ),
      fl(1, `<div class="st"><div><span>K/D</span><b>${formatKd(killDeath(r))}</b></div><div><span>K/D/A</span><b>${kda(r)}</b></div><div><span>ADR</span><b>${recapAdr(r)}</b></div><div><span>HS</span><b>${recapHs(r)}</b></div></div>`),
      palm.length ? fl(2, `<div class="palm">${palm.join('')}</div>`, 'th') : '',
      r.best ? fl(3, `Meilleur <b>${esc(bestLine(r))}</b>`, 'th') : '',
      fl(4, `Se replie dans <b>${x.endLeft}${NB}s</b>`, 'th')
    ]
    return ens(flags, hold(logo()))
  }
}

// ---------- Régie : bandeaux de retransmission, coupés en biais ----------

/** La courbe de l'écart au score, round après round (rounds au camp inconnu : la courbe reste à plat). */
function momentum(rs: Cs2Round[]): string {
  let d = 0
  const pts: [number, number][] = [[0, 0]]
  rs.forEach((r, i) => {
    const w = won(r)
    d += w === undefined ? 0 : w ? 1 : -1
    pts.push([i + 1, d])
  })
  const n = Math.max(1, rs.length)
  const top = Math.max(5, ...pts.map(([, y]) => Math.abs(y)))
  const w = 560, h = 160, sx = w / n, sy = Math.min(14, 70 / top), y0 = 90
  const P = pts.map(([x, y]) => `${(x * sx).toFixed(1)},${(y0 - y * sy).toFixed(1)}`).join(' ')
  const lab = (x: number, y: number, t: string, anchor = 'start'): string =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="rgba(255,255,255,.6)" font-family="Inter" font-size="15" font-weight="700">${t}</text>`
  const half = rs.findIndex((r) => r.n === 13)
  return `<svg viewBox="-30 0 ${w + 40} ${h + 24}" aria-hidden="true">
<line x1="0" x2="${w}" y1="${y0}" y2="${y0}" stroke="rgba(255,255,255,.3)" stroke-width="2"/>
${half > 0 ? `<line x1="${half * sx}" x2="${half * sx}" y1="6" y2="${h}" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="6 6"/>${lab(half * sx + 8, h, 'MI-TEMPS')}` : ''}
<polygon points="0,${y0} ${P} ${(rs.length * sx).toFixed(1)},${y0}" fill="rgba(232,38,79,.28)"/>
<polyline points="${P}" fill="none" stroke="#e8264f" stroke-width="5" stroke-linejoin="round"/>
<circle cx="${(rs.length * sx).toFixed(1)}" cy="${(y0 - d * sy).toFixed(1)}" r="8" fill="#fff"/>
${lab(-8, y0 + 5, '0', 'end')}${lab(-8, y0 - 5 * sy + 5, '+5', 'end')}
<line x1="0" x2="${w}" y1="${y0 - 5 * sy}" y2="${y0 - 5 * sy}" stroke="rgba(255,255,255,.1)" stroke-width="1"/>
${lab(0, h + 22, `R${rs[0]?.n ?? 1}`)}${lab(w, h + 22, `R${rs.at(-1)?.n ?? 1} · ${d > 0 ? '+' : ''}${d}`, 'end')}
</svg>`
}
const ORD = (n: number): string => (n === 1 ? 'ton premier' : `ton ${n}e`)

const regie = {
  buy(live: Cs2Live, x: Extra): string {
    const e = eco(live, x.budget)
    const sc = live.score && e.side
    return `<div class="l3">
<div class="row"><span class="mark" style="width:48px;height:56px;margin-right:6px">${logo()}</span><span class="sl r f22" style="--i:0"><span>Round ${live.round}</span></span><span class="sl f22" style="--i:1"><span>${esc(mapLabel(live.map))} · ${esc(modeLabel(live.mode))}</span></span></div>
${sc ? `<div class="row"><span class="sl scorebar" style="--i:2"><span class="stripe" style="background:var(--${e.side === 'CT' ? 'ct' : 't'})"></span><span class="s ${sideCls(e.side)}">${e.side} · toi</span><span class="n">${live.score!.us}</span><span class="v"></span><span class="n" style="opacity:.6">${live.score!.them}</span><span class="s ${sideCls(other(e.side!))}">${other(e.side!)}</span></span></div>` : ''}
${e.cash !== undefined ? `<div class="row"><span class="sl w f30" style="--i:3"><span>${esc(money(e.cash))}</span></span>${e.adv ? `<span class="sl f22" style="--i:4"><span>${esc(e.adv.title)} <span style="color:rgba(255,255,255,.7)">· ${esc(e.adv.detail)}</span></span></span>` : ''}</div>` : ''}
${e.next !== undefined ? `<div class="row"><span class="sl tick" style="--i:5"><span>Même en perdant : au moins <b>${esc(money(e.next))}</b> au round ${live.round + 1}${e.nextAdv ? ` · ${esc(e.nextAdv.title.toLowerCase())}` : ''}</span></span></div>` : ''}
<div class="row"><span class="sl tick" style="--i:5"><span><b>${kda(live)}</b>K/D/A · <b>${adrOf(live)}</b>ADR · <b>${pct(live.hsPct)}</b>HS</span></span></div></div>`
  },
  pill(live: Cs2Live, x: Extra): string {
    const k = live.roundKills
    const m = multiName(k)
    const bug = `<div class="bug">${logo(k, !!m && x.fresh)}<span>${kda(live)}</span><small>· ${k}${NB}élim.</small></div>`
    if (!m || !x.fresh) return bug
    // Combien de rounds du match avec autant d'élim. (les rounds finis, plus celui-ci)
    const nth = live.rounds.filter((r) => Math.min(5, r.kills ?? 0) === Math.min(5, k)).length + 1
    return `<div class="flashw"></div>${bug}
<div class="sting"><div class="big" style="display:flex;align-items:center;gap:26px"><span class="mark" style="width:110px;height:128px">${logo(k)}</span>${m[0]} !</div><div class="sub"><b>${k}${NB}élim.</b> au round ${live.round} · ${ORD(nth)} ${m[0].toLowerCase()} du match</div></div>`
  },
  half(live: Cs2Live): string {
    const { played, sc, lead } = halfInfo(live)
    const rs = live.rounds.length ? halfRounds(live.rounds, live.rounds.at(-1)!.n) : []
    return `<div class="band">
<div class="hd"><span class="t">Mi-temps · ${esc(mapLabel(live.map))}</span>${sc ? `<span class="n">${sc.us}–${sc.them}</span>` : ''}<span class="s">${esc(lead)}${played ? ` · tu passes <span class="${sideCls(other(played))}">${other(played)}</span>` : ''}</span></div>
${rs.length ? `<div class="bars"><span class="cap">TES ÉLIM. PAR ROUND · ROUGE = ROUND GAGNÉ</span><div class="g">${rs.map((r, i) => `<div><span>${r.kills ?? '–'}</span><i class="${won(r) ? 'w' : ''}" style="--i:${i};height:${8 + Math.min(5, r.kills ?? 0) * 20}px"></i><em>${r.n}</em></div>`).join('')}</div></div>` : ''}
<div class="bstats"><div><span>K/D/A</span><b>${kda(live)}</b></div><div><span>K/D</span><b>${formatKd(killDeath(live))}</b></div><div><span>ADR</span><b>${adrOf(live)}</b></div><div><span>HS</span><b>${pct(live.hsPct)}</b></div></div></div>`
  },
  end(r: Cs2Recap, x: Extra): string {
    const strong = r.best ? `Moment fort : <b>${esc(bestLine(r))}</b> · ${r.mvps}${NB}MVP` : `${r.mvps}${NB}MVP`
    const curve = r.rounds.length >= 2
    const left = `se replie dans ${x.endLeft}${NB}s`
    return `<div class="panel">
<div class="ph" style="--i:0;display:flex;align-items:center;gap:14px"><span class="mark" style="width:34px;height:40px;filter:none">${logo()}</span>Bilan du match · ${esc(mapLabel(r.map))}${r.sample ? ' · exemple' : ''}</div>
<div class="pr" style="--i:1"><span class="w">${esc(RESULT_LABEL[r.result])}</span>${r.score && r.result !== 'left' ? `<span class="s">${r.score.us}–${r.score.them}</span>` : ''}</div>
${curve ? `<div class="pb" style="--i:2"><div class="cap"><span>L’écart au score</span><span>${left}</span></div>${momentum(r.rounds.slice(-30))}</div>` : ''}
<div class="pb" style="--i:3"><div class="ps"><div><span>K/D</span><b>${formatKd(killDeath(r))}</b></div><div><span>K/D/A</span><b>${kda(r)}</b></div><div><span>ADR</span><b>${recapAdr(r)}</b></div><div><span>HS</span><b>${recapHs(r)}</b></div></div></div>
<div class="pm" style="--i:4">${strong}${curve ? '' : ` · ${left}`}</div></div>`
  }
}

const STYLES = { etendard, viseur, regie }

/** La pièce du moment, dans le style choisi. */
export function threeHtml(style: ThreeStyle, p: Piece, x: Extra): string {
  const S = STYLES[style]
  // Mêmes ids d'un rendu à l'autre : la même pièce donne la même chaîne, et rien n'est reposé pour rien.
  LID = 0
  if (p.kind === 'end') return S.end(p.recap, x)
  return S[p.kind](p.live, x)
}

/** Ce qui fait « un autre moment » : les entrées se rejouent seulement quand il change. */
export function threeKey(style: ThreeStyle, p: Piece): string {
  if (p.kind === 'end') return `${style}|end|${p.recap.id}`
  // Une élim. de plus : le logo s'allume d'un cran, avec son entrée. Le bandeau de la Régie part sans rien rejouer.
  if (p.kind === 'pill') return `${style}|pill|${p.live.round}|${p.live.roundKills}`
  return `${style}|${p.kind}|${p.live.round}`
}
