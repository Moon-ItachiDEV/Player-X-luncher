# Player X V3 Test

Version d'essai de la nouvelle interface de Player X (« V3 »), installée à part du vrai Player X : autre nom, autre dossier
(`%LOCALAPPDATA%\Programs\test-v3-player-x`), autres données (`%APPDATA%\Player X V3 Test`), identifiant
`dev.breezy.playerx.v3test`. Le code est dans le dépôt GitHub `Moon-ItachiDEV/player-x-luncher` : rien n'y est poussé sans
l'ordre « Publier » de Breezydev. Les mises à jour automatiques n'existent pas dans cette version.

- Interface : `v3ui/` (JS et CSS sans framework), assemblée par `python3 v3ui/build.py`.
- Moteur (processus principal) : `src/main/`, pont `src/preload/`, règles partagées `src/shared/`.
- Overlay CS2 : `src/renderer/` ; enregistrement des clips : `src/renderer/public/clips-recorder.*`.
- Installeur sur mesure : `installer/` (Go + WebView2), construit par `scripts/build-installer-v3test.mjs`.
- Moteur vidéo du montage : FFmpeg (licence LGPL), livré tel quel avec l'appli. Son build est épinglé dans
  `src/shared/ffmpegPin.json` et récupéré par `scripts/fetch-ffmpeg.mjs` (il n'est pas dans git).
- Montage : « Faire le film » sur la page Clips. Règles et commandes : `src/main/services/editPlan.ts` et
  `editCompile.ts` ; fabrication : `editFilm.ts`.

Comment l'appli est construite (couches, démarrage, canaux, garde-fous) : `docs/ARCHITECTURE.md`.
Contrôler : `npm run typecheck`, puis `npm test` (tous les `*.test.ts` de `src/`, trouvés tout seuls).
Reconstruire et livrer : voir `NOTES.md`.
