# Player X V3 Test

Version d'essai de la nouvelle interface de Player X (« V3 »), lanceur de jeux pour Windows fait avec Electron.
Elle s'installe à part du vrai Player X et n'a pas de mise à jour automatique.

- Dossier d'installation : `%LOCALAPPDATA%\Programs\test-v3-player-x`
- Données : `%APPDATA%\Player X V3 Test`
- Identifiant : `dev.breezy.playerx.v3test`

## Prérequis

- Node.js 22.6 ou plus récent, Python 3
- Pour l'installeur : Go 1.22 ou plus récent (et Wine + Xvfb pour construire depuis Linux)

## Commandes

```
npm ci              # dépendances
npm run dev         # lancer en développement
npm run typecheck   # contrôle des types
npm test            # tous les *.test.ts de src/
npm run dist        # FFmpeg, tests, puis installeurs Windows dans dist/
```

Étapes de reconstruction et de livraison : `NOTES.md`.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `v3ui/` | Interface (JS et CSS sans framework), assemblée par `python3 v3ui/build.py` |
| `src/main/` | Moteur (processus principal) |
| `src/preload/` | Pont entre le moteur et l'interface |
| `src/shared/` | Règles partagées |
| `src/renderer/` | Overlay CS2 et enregistrement des clips (`public/clips-recorder.*`) |
| `installer/` | Installeur sur mesure (Go + WebView2), construit par `scripts/build-installer-v3test.mjs` |
| `tools/` | Scénarios d'essai sur l'appli réelle (Linux) |

Montage (« Faire le film » sur la page Clips) : règles et commandes dans `src/main/services/editPlan.ts` et
`editCompile.ts`, fabrication dans `editFilm.ts`.

Architecture détaillée : `docs/ARCHITECTURE.md`.

## FFmpeg

Le montage utilise FFmpeg 9.0.2 (licence GNU LGPL v3 ou ultérieure), livré tel quel avec l'appli. Son build est épinglé
dans `src/shared/ffmpegPin.json` et récupéré par `scripts/fetch-ffmpeg.mjs` dans `vendor/ffmpeg/`, hors de git.

## Licences

Aucun fichier de licence n'est publié pour le code de ce dépôt. Licences des polices : `v3ui/fonts/licences/`.

## Contribution

Rien n'est poussé sur ce dépôt sans l'accord de Breezydev.
