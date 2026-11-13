# Passation : Player X V3 Test (bêta 43)

Pour reprendre ce projet avec un autre compte Claude. À lire en entier, puis `README.md`, `docs/ARCHITECTURE.md` (schémas) et `NOTES.md`.

## Le projet
- **Player X** : lanceur de jeux pour Windows (Electron). Le vrai Player X est un dépôt GitHub public (Moon-ItachiDEV/player-x), version 0.9.x.
- **Ce dossier : « Player X V3 Test »**, version 0.5.3-beta.43 : la nouvelle interface « V3 » et des fonctions nouvelles (clips, montage de films, loadouts, GOG), construites **à part** : autre nom, autre dossier d'installation, autres données, appId `dev.breezy.playerx.v3test`. Il n'est **jamais** poussé sur GitHub. La 0.5.3 remplacera plus tard la version GitHub, mais seulement sur ordre de Breezydev.
- L'utilisateur : **Breezydev**. Il parle français, tutoie, veut des mots simples.

## Règles de travail (de Breezydev, toujours valables)
- Répondre en français, mots simples. Pas de sous-informations inutiles dans l'interface.
- Design : tons proches avec un accent rose, fenêtre au plus 1600×940, une seule action principale par écran, données réelles seulement (jamais d'exemple).
- Ne jamais travailler à l'aveugle ; ne jamais supprimer du code sans l'avoir vérifié ; ne jamais réécrire l'appli en entier sans nécessité ; ne jamais modifier plusieurs composants critiques en même temps ; ne jamais sacrifier une fonction pour simplifier ; une compilation réussie ne prouve pas la stabilité ; ne jamais masquer un problème ; ne jamais dire qu'un test est réussi s'il n'a pas tourné ; ne jamais présenter une idée comme une chose faite ; ne jamais remplacer une version stable par une version non validée.
- **Sécurité** : la clé privée de mise à jour `player-x-update-ed25519.pem` ne va jamais sur GitHub, dans un commit, un message, un journal ni un document. Ne jamais lire, copier ou afficher un fichier `.pem` ou `.env`. Aucune clé d'API Riot dans l'appli. Ne pas contourner un contrôle de sécurité : le dire à Breezydev.
- **Publication** : ne publier que quand Breezydev écrit « Publier ». Bêta d'abord, fusion seulement sur son ordre. Commit ou push seulement sur sa demande. Pas de force-push.
- Les bêtas se livrent en 3 zips : installeur V3, installeur classique, source. Chaque livraison a un `LISEZ-MOI.txt` (UTF-8 avec BOM, fins de ligne CRLF) qui dit ce qui change depuis la bêta d'avant.

## Reconstruire et contrôler
1. `npm ci`
2. `npm run typecheck` puis `npm test` (468 tests, 1 ignoré). `npm run test:edit` : montage et capture par le moteur.
3. `npm run build` (assemble `v3ui/` avec `python3 v3ui/build.py`, puis electron-vite).
4. `npm run dist` (ou `node scripts/dist-v3.mjs <dossier>`) : moteur vidéo, tests, NSIS (classique) et installeur sur mesure (Go + WebView2). Sous Linux : Wine, Xvfb, Go, llvm-rc.
- Le moteur vidéo `vendor/ffmpeg/ffmpeg.exe` (FFmpeg 9.0.2 LGPL, ~132 Mo) n'est pas dans ce zip : `node scripts/fetch-ffmpeg.mjs` le télécharge et vérifie son empreinte (`src/shared/ffmpegPin.json`).
- Ce zip n'a pas l'historique git (L1 à L43). L'historique recommence à zéro avec un `git init` si besoin.

## Carte du code
- `v3ui/` : interface (JS et CSS sans framework). `src/main/` : processus principal. `src/preload/` : ponts. `src/shared/` : règles partagées. `src/renderer/` : overlay CS2 et page cachée de capture. `installer/` : installeur Go.
- Clips : `clips.ts` (tampon, écriture), `engineCapture.ts` (capture par le moteur), `fmp4.ts`, `clipsPlan.ts`, `cs2Moments.ts`, `src/renderer/public/clips-recorder.js`.
- Montage de films : `editPlan.ts`, `editCompile.ts`, `editFilm.ts`, `editBeats.ts`, `editMusic.ts`, `src/shared/editShots.ts`, interface `v3ui/src/edit.js`.
- Jeux : `games.ts` (Steam, Epic, EA, GOG), `gogInfo.ts`, `launches.ts`, `playtime.ts`.
- Loadouts Battlefield 6 : `v3ui/src/data.js` (`BF6_RECO`, `BF6_WEAPONS`), `real-friends.js`.
- Tests d'essai sous Linux : `tools/essais` et `tools/essais-clips` (variables `PX_CS2_SIM`, `PX_CLIP_TEST_SOURCE`, `PX_ENGINE_SOURCE=x11`, etc. : voir `NOTES.md`).

## Ce qui a été fait (bêtas 34 à 43)
- 34 : loadouts du Mini Scout. 35 : vrai éditeur de frag movie (musique, rythme, montage, suppression d'un clip). 36–37 : essais contre les clips qui saccadent. 38–40 : essai « capture comme OBS » dans Paramètres. 41 : installeur plus clair. 42 : **les clips sont filmés par le moteur vidéo** (fenêtre du jeu, NVENC) au lieu de Chrome. 43 : son des clips sans glissement (horloge audio), **jeux GOG détectés**.

## Ce qu'il reste à faire
- **À confirmer par Breezydev sur Windows** : un clip CS2 de la bêta 43 (son qui tombe pile sur l'image) ; les 2 jeux GOG qu'il a installés (apparaissent-ils, se lancent-ils ?). Si un jeu GOG manque : Bibliothèque › Relancer la recherche › « Voir les dossiers examinés ».
- Mesuré chez lui : le moteur donne 53 à 58 images/s en CS2 (2560×1440), contre 15 à 53 avec Chrome.
- Plus tard : effets, transitions, format vertical, montage par Claude ; réduction 1080p sans `scale_d3d11` (il casse la chaîne chez lui) ; avertissement dans l'appli si la capture passe sous 50 images/s.
- Plus ancien : page vitrine du site (en attente de son avis ou de « Publier ») ; accessoires de sniper dans l'atelier ; l'overlay de V3 Test doit se taire quand l'autre Player X tourne.

## Pièges connus
- La capture d'écran de Chrome ne suit pas quand la carte graphique est saturée : c'est pour ça que le moteur vidéo filme.
- `scale_d3d11` casse la chaîne d'image sur son PC : ne pas le remettre.
- Le son venu de MediaRecorder arrive en retard d'un délai variable (~1 s) : ne jamais le recoller à une image du moteur.
- Le moteur vidéo livré n'est pas lançable sous Linux (Wine refusé) : les essais Linux utilisent un FFmpeg local avec `PX_FFMPEG`.
- Le disque de travail se remplit vite : supprimer les anciens dossiers `dist*` et zips.
