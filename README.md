# Player X V3 Test

Version d'essai de la nouvelle interface de Player X (« V3 »). Player X est un lanceur de jeux pour Windows, construit avec Electron (Electron 44.11.3, TypeScript, electron-vite, electron-builder). Cible : Windows x64 uniquement (NSIS).

Cette version s'installe à part du vrai Player X :

- nom : Player X V3 Test ;
- dossier d'installation : `%LOCALAPPDATA%\Programs\test-v3-player-x` (non modifiable) ;
- données : `%APPDATA%\Player X V3 Test` ;
- identifiant : `dev.breezy.playerx.v3test`.

Cette version n'a pas de mise à jour automatique (`"publish": null` dans `package.json`, aucun module de mise à jour dans le code).

Dépôt GitHub : `Moon-ItachiDEV/player-x-luncher`.

## Prérequis

- Node.js 22.6 ou plus récent (les tests s'exécutent avec `node --experimental-strip-types`).
- npm.
- Python 3 (assemblage de l'interface).
- Pour le paquet Windows complet : Go 1.22 ou plus récent (installeur).
- Pour construire le paquet depuis Linux : Wine et Xvfb (pour NSIS). `llvm-rc` est facultatif (icône et manifeste de l'installeur ; sans lui, ceux de `installer/` sont utilisés).

## Installation et développement

```
npm ci
npm run dev
```

| Commande | Effet |
| --- | --- |
| `npm run ui` | Assemble uniquement l'interface (`python3 v3ui/build.py`). |
| `npm run dev` | Assemble l'interface, puis lance `electron-vite dev`. |
| `npm run build` | Assemble l'interface, puis `electron-vite build` vers `out/`. |

## Tests

```
npm run typecheck
npm test
```

`npm test` exécute tous les fichiers `*.test.ts` sous `src/`. `scripts/test-all.mjs` les trouve seul : aucune liste à tenir.

Pour ne lancer que les fichiers dont le chemin contient l'un des mots donnés :

```
npm test -- clips edit
```

Des scripts de groupe existent aussi : `npm run test:clips`, `npm run test:edit`, etc.

### Scénarios sur l'appli réelle

Réservés à Linux, pour le développement. Ils se trouvent dans `tools/essais/` et `tools/essais-clips/`. Ils exigent `npm run build` au préalable, ainsi que Xvfb, ffmpeg, ffprobe et Playwright (installés séparément, absents de `package.json`).

```
node tools/essais/tous.cjs
node tools/essais/tous.cjs a8 t1
```

La première commande lance tous les scénarios (environ une demi-heure). La seconde en lance un sous-ensemble.

## Construire l'installeur

```
npm run dist
```

`scripts/dist-v3.mjs` enchaîne les étapes suivantes et s'arrête à la première erreur :

1. récupération de FFmpeg ;
2. assemblage de l'interface ;
3. contrôle de types ;
4. tests ;
5. `electron-vite build` ;
6. `electron-builder` (NSIS) ;
7. installeur sur mesure en Go.

Les fichiers sont écrits dans `dist/`. Un autre dossier peut être donné : `node scripts/dist-v3.mjs <dossier>`.

Fichiers produits :

- `Player-X-V3-Test-Setup-<version>.exe` (NSIS) ;
- `Player-X-V3-Test-Installer-<version>.exe` (installeur sur mesure).

Le script `scripts/build-installer-v3test.mjs` refuse de construire avec l'identité du vrai Player X. Les étapes de reconstruction et de livraison sont décrites dans `NOTES.md`.

Les fusibles Electron (`build.electronFuses` dans `package.json`) verrouillent l'exécutable : pas de mode Node, pas de `NODE_OPTIONS` ni de `--inspect`, intégrité de `app.asar` vérifiée.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `v3ui/` | Interface (JS et CSS sans framework), assemblée par `python3 v3ui/build.py`. |
| `src/main/` | Moteur (processus principal). |
| `src/preload/` | Pont entre le moteur et l'interface. |
| `src/shared/` | Règles partagées. |
| `src/renderer/` | Overlay CS2. L'enregistrement des clips est dans `src/renderer/public/clips-recorder.*`. |
| `installer/` | Installeur sur mesure (Go + WebView2). |
| `scripts/` | Scripts de construction et de tests. |
| `resources/` | Icônes. |
| `tools/` | Outils de développement, dont les scénarios `tools/essais/`. |

Le montage s'utilise par « Faire le film » sur la page Clips. Les règles et les commandes sont dans `src/main/services/editPlan.ts` et `editCompile.ts`. La fabrication est dans `editFilm.ts`.

## FFmpeg

FFmpeg est le moteur vidéo du montage. Il est livré tel quel avec l'appli.

- Version 9.0.2, build Windows 64 bits LGPL de BtbN/FFmpeg-Builds.
- Le build est épinglé dans `src/shared/ffmpegPin.json` (URL et SHA-256 de l'archive zip et de l'exécutable).
- `scripts/fetch-ffmpeg.mjs` télécharge l'archive (environ 169 Mo, une seule fois), vérifie les empreintes et extrait dans `vendor/ffmpeg/`, ignoré par git : `ffmpeg.exe`, `LICENSE.txt` et `SOURCE.txt` (emplacement des sources).
- Hors ligne : `node scripts/fetch-ffmpeg.mjs <zip déjà téléchargé>`.
- Le processus principal revérifie le fichier par rapport à la même épingle avant de l'exécuter.
- L'appli empaquetée livre `ffmpeg.exe`, `LICENSE.txt` et `SOURCE.txt` dans son dossier de ressources `ffmpeg`.

## Licences

Aucun fichier de licence n'est publié pour le code propre à ce dépôt.

Composants tiers :

- FFmpeg : GNU LGPL version 3 ou ultérieure.
- Polices de `v3ui/fonts/` : licences dans `v3ui/fonts/licences/`.
- Autres dépendances : listées dans `package.json`.

## Documentation

- `docs/ARCHITECTURE.md` : couches, démarrage, canaux, garde-fous.
- `NOTES.md` : notes de travail et étapes de reconstruction.
- `PASSATION.md` : document de passation.
- `docs/design/` : notes de conception.

## Contribution

Aucune modification n'est poussée sur ce dépôt sans l'accord de Breezydev (mainteneur), donné par l'ordre « Publier ».
