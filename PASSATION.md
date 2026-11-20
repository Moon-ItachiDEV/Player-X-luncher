# Passation : Player X V3 Test (0.7.6)

Pour reprendre ce projet rapidement. À lire en entier, puis `README.md`, `docs/ARCHITECTURE.md` (schémas) et `NOTES.md`.

## Le projet
- **Player X** : lanceur de jeux pour Windows (Electron). Le vrai Player X est un dépôt GitHub public (`Moon-ItachiDEV/player-x`), version 0.9.x.
- **Ce dossier : « Player X V3 Test »**, version `0.7.6` : la nouvelle interface « V3 » et les fonctions nouvelles (clips, montage de films, loadouts BF6, GOG, partage Discord, Stats Cockpit, Mon PC + pilote NVIDIA, mises à jour signées Ed25519 dans l'appli), construites **à part** : autre nom, autre dossier d'installation, autres données, `appId` `dev.breezy.playerx.v3test`. Depuis le 13/11 (bêta 44), son code est sur GitHub dans `Moon-ItachiDEV/Player-X-luncher`, sur décision de Breezydev ; rien n'y part sans son ordre.
- L'utilisateur : **Breezydev**. Il parle français, tutoie, veut des mots simples.

## Règles de travail (de Breezydev, toujours valables)
- Répondre en français, mots simples. Pas de sous-informations inutiles dans l'interface.
- Design : tons proches avec un accent rose, fenêtre au plus 1600×940, une seule action principale par écran, données réelles seulement (jamais d'exemple).
- Ne jamais travailler à l'aveugle ; ne jamais supprimer du code sans l'avoir vérifié ; ne jamais réécrire l'appli en entier sans nécessité ; ne jamais modifier plusieurs composants critiques en même temps ; ne jamais sacrifier une fonction pour simplifier ; une compilation réussie ne prouve pas la stabilité ; ne jamais masquer un problème ; ne jamais dire qu'un test est réussi s'il n'a pas tourné ; ne jamais présenter une idée comme une chose faite ; ne jamais remplacer une version stable par une version non validée.
- **Sécurité** : la clé privée de mise à jour `player-x-update-ed25519.pem` (et `~/.player-x/cle-maj.pem`) ne va jamais sur GitHub, dans un commit, un message, un journal ni un document. Ne jamais lire, copier ou afficher un fichier `.pem` ou `.env`. Aucune clé d'API Riot dans l'appli. Ne pas contourner un contrôle de sécurité : le dire à Breezydev.
- **Publication** : ne publier que quand Breezydev écrit « Publier ». Bêta d'abord, fusion seulement sur son ordre. Commit ou push seulement sur sa demande. Pas de force-push.
- Les bêtas se livrent en 3 zips : installeur V3, installeur classique, source. Chaque livraison a un `LISEZ-MOI.txt` (UTF-8 avec BOM, fins de ligne CRLF) qui dit ce qui change depuis la bêta d'avant.

## Reconstruire et contrôler
1. `npm ci`
2. `npm run typecheck` (4 configurations : `tsconfig.node.json` tests renderer compris, `tsconfig.web.json`, `tsconfig.scripts.json`, `tsconfig.v3ui.json` qui vérifie `v3ui/src/*.js` et `clips-recorder.js` face à `LauncherApi` et `Shared`).
3. `npm test` (712 tests passés, 1 ignoré ; zéro avertissement `MODULE_TYPELESS_PACKAGE_JSON`). `npm run test:edit` : montage et capture moteur ; `npm run test:clips` : clips, rythme réel, copie Discord ; `npm run test:maj` : mises à jour et publication.
4. `npm run build` (assemble `v3ui/` en Node pur via `node v3ui/build.mjs` + `esbuild`, puis `electron-vite build` — plus besoin de Python).
5. `npm run dist` (ou `node scripts/dist-v3.mjs <dossier>`) : moteur vidéo, interface V3, types, tests, NSIS (classique) et installeur sur mesure (Go + WebView2). Sous Linux : Wine, Xvfb, Go, llvm-rc.
6. Intégration continue : `.github/workflows/ci.yml` lance automatiquement `typecheck`, `test`, `build` et la compilation croisée Windows x64 de `installer/` sur chaque push sur `main` et chaque PR.
- Le moteur vidéo `vendor/ffmpeg/ffmpeg.exe` (FFmpeg 9.0.2 LGPL, ~132 Mo) n'est pas dans git : `node scripts/fetch-ffmpeg.mjs` le télécharge et vérifie son empreinte (`src/shared/ffmpegPin.json`).
- L'historique git commence à la bêta 44 (`Moon-ItachiDEV/Player-X-luncher`) ; les bêtas 1 à 43 n'y sont pas.

## Carte du code
- `v3ui/` : interface (JS et CSS sans framework, polices `.woff2` locales, typée par `v3ui/types.d.ts` + `tsconfig.v3ui.json`, assemblée par `node v3ui/build.mjs`).
- `src/main/` : processus principal. Tous les récepteurs `handle()` vivent exclusivement dans `src/main/channels/` (`account`, `clips`, `cs2Overlay`, `edit`, `friends`, `library`, `maj`, `pc`, `play` — garanti par `ipcContract.test.ts`). Les clés `kv` de `db.ts` sont typées par `KvKey`.
- `src/preload/` : ponts (`index.ts`, `overlay.ts`, `clipsRecorder.ts`). `src/shared/` : règles et types partagés.
- `src/renderer/` : overlay CS2 et page cachée de capture (`clips-recorder.html/.js`). `installer/` : installeur Go + WebView2.
- Scénarios sous Linux : `tools/essais/tous.cjs` lance `a1..a18`, les 17 scénarios nommés (`amis`, `cx`, `ed`, `garde`, `hx`, `maj`, `pe`, `stats-cockpit`, `stats-etats`, `witcher`…) et `tools/essais-clips/t0..t26`.

## Ce qui a été fait (0.6 → 0.7.6)
- **0.6 à 0.6.2** : overlay CS2 style blason + placement plein écran ; page Clips Viseur & Régie ; mise à jour pilote NVIDIA depuis Mon PC ; Paramètres Essentiel ; Amis Escouades & Portraits.
- **0.7.0** : assemblage unifié + Stats Cockpit (CS2 & BF6).
- **0.7.1** : éditeur de films lot A (brouillons persistés, aperçu synchronisé à la musique `pxclip://music/`, glisser des bords/ancres/ordre, correction absolue du tempo ×2/÷2).
- **0.7.2 → 0.7.5** : mises à jour signées Ed25519 dans l'appli (`maj.json` + `maj.json.sig`, `scripts/publier-maj.mjs`, `Publier.bat`), stabilisation et petits correctifs.
- **0.7.6 (audit complet — Priorités 1 à 4)** :
  - **P1 (bugs & pertes de données + 4 bugs clips)** : correctifs `cs2Overlay` (suppression `destroy` prématuré, raccourcis), `editBeats`/`editCompile`/`editFilm` (dérive tempo, suppression plan, nettoyage), `clipsSave`/`clipsBuffer`/`clipsFiles`/`clips-recorder.js` (fenêtres MP4, synchro PCM, troncature/destruction de clips), `games`/`gogInfo`/`routines`/`shelves`.
  - **P2 (sécurité & cycle de vie)** : durcissement pilote NVIDIA (TOCTOU, UAC, SHA-256/signature), `updater.ts` (vérification finale, anti-course), échappement PowerShell (`pc.ts`, `playtime.ts`, `launchWatch.ts`), fermeture propre, garde-fous IPC (`isAuxiliary`, bornes), OAuth (`auth.ts`), routines.
  - **P3 (performances & interface)** : réseau/hors-ligne (`net.fetch`, backoff 429, pas de faux « Profil privé » hors ligne, scan succès ciblé, concurrence PSN/artwork/BF6 bornée) ; coût arrière-plan Windows/SQLite (`tasklist` léger au repos, requêtes numérotées `launchWatch`, index SQLite `launches`/`sessions`, `persistAsync` + `flushDb` strict, lecture unique `readAllOther`) ; `v3ui` (`fluid.js` WebGL/mur paresseux, suppression code mort `board.js`/`board.css`, polices `.woff2` locales et dédupliquées, échappement `'`/`amUrl`/`CSS.escape`, `clipPath` SVG).
  - **P4 (build, publication, CI, types, architecture)** : `v3ui/build.mjs` (Node pur, fin de Python), nettoyage `package.json` + 0 avertissement `MODULE_TYPELESS_PACKAGE_JSON`, `publier-maj.mjs` & `Publier.bat` (installeur Go inclus, détection préversion semver, branche git courante), installeur Go (`run()` avec `defer`, dossier WebView2 unique par instance, GOG dans l'accueil, `app.asar` au lieu d'`app-update.yml`), `tous.cjs` (scénarios nommés inclus), `.github/workflows/ci.yml`, `tsconfig.v3ui.json` + tests renderer dans `tsconfig.node.json`, extraction `channels/clips.ts` & `channels/cs2Overlay.ts`, `KvKey` typé dans `db.ts`, `unexpectedFailure` élargi aux pannes techniques externes.

## Ce qu'il reste à confirmer sur un vrai PC Windows
- Mise à jour du pilote NVIDIA de bout en bout (signature, UAC, point de restauration, exécution de l'installeur NVIDIA, relecture version).
- Capture moteur vidéo + clips CS2 (synchro image/son, rythme réel, « Copier pour Discord » > 20 Mo, essai réduit 1080p) et fabrication d'un vrai film avec `vendor/ffmpeg/ffmpeg.exe`.
- Overlay CS2 en jeu (placement plein écran, Échap, silence quand l'autre Player X tourne).
- Mises à jour dans l'appli (Setup NSIS `/S`, redémarrage, relance après installation) et installeur sur mesure Go (`Player-X-Installer-0.7.6.exe`, deux ouvertures simultanées, nettoyage `%TEMP%`).
- Sondage léger `tasklist` → PowerShell dans `playtime.ts`, détection et lancement des jeux GOG.

## Pièges connus
- La capture d'écran de Chrome ne suit pas quand la carte graphique est saturée : c'est pour ça que le moteur vidéo filme.
- `scale_d3d11` casse la chaîne d'image sur le PC de Breezydev : ne pas le remettre.
- Le son venu de MediaRecorder arrive en retard d'un délai variable (~1 s) : ne jamais le recoller à une image du moteur.
- Le moteur vidéo livré n'est pas lançable sous Linux (Wine refusé) : les essais Linux utilisent un FFmpeg local avec `PX_FFMPEG`.
- Le disque de travail se remplit vite : supprimer les anciens dossiers `dist*` et zips.
- Les clips d'essai sous Linux (640 × 360) pèsent 1 à 3 Mo, sous toutes les limites de Discord : `PX_CLIP_TEST_SHARE_MB` impose une limite pour essayer la copie légère (`t15-partage.cjs`).
