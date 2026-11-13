# Player X V3 réel : notes de travail (build à part, rien sur GitHub)

Demande du 03/11 19:32 : « rends tout sa utilisable sans ezxemple » + « tjs ds un build differant de ma version github ;) »

## Architecture
- Ce dossier = copie de c48a1ce (git archive, 0.9.7-beta.16), séparée du vrai Player X (nom, appId dev.breezy.playerx.v3test, GSI à part port 47770, publish null). Pas de mise à jour automatique : le code correspondant a été retiré (il reste dans le vrai Player X).
- Processus principal : src/main/index.ts (démarrage, fenêtre, bibliothèque) ; les canaux IPC sont rangés dans src/main/channels/ (library, friends, account, play) ; envois aux fenêtres, raccourcis et erreurs communs dans windows.ts, hotkeys.ts, errors.ts, crashLog.ts. Types partagés : src/shared/types/ (réexportés par src/shared/types.ts).
- Fenêtre principale = V3 vanilla : sources dans v3ui/ (JS + CSS), construites par python3 v3ui/build.py vers src/renderer/public/v3/ (fichiers générés, pas suivis par git ; copiés dans out/renderer/v3/ par electron-vite). Modules purs partagés avec la V3 : src/shared/view/.
- Overlay CS2 = JS sans framework (src/renderer/index.html → src/main.ts → overlay/overlay.ts, view.ts, dom.ts), preload à part (src/preload/overlay.ts, window.pxOverlay : ses 6 envois cs2:* seulement). Polices : Inter et Sora en latin woff2 (styles/fonts.css). Plus de React dans le projet.
- Enregistrement, sans binaire ni dépendance ajoutés :
  - src/main/services/clips.ts : le moteur (tampon sur disque, écriture des clips, API, pxclip://).
  - src/main/services/fmp4.ts et clipsPlan.ts : MP4 sans réencodage. Tampon fragmenté, clip classique (moov devant).
  - src/main/services/cs2Moments.ts : les kills du fichier de Valve deviennent des moments.
  - src/preload/clipsRecorder.ts + src/renderer/public/clips-recorder.html/.js : fenêtre cachée, getDisplayMedia + MediaRecorder.
  - Une découpe crée un nouveau clip, l'original reste.
  - Copie vers Discord : Set-Clipboard -LiteralPath de PowerShell (vrai CF_HDROP).

## Loadouts conseillés (Battlefield 6)
- Les builds relevés en jeu sont dans BF6_RECO (v3ui/src/data.js) : MK 24, DRS-IAR, SGX, et depuis la bêta 34 le Mini Scout (« Mon choix : laser et chargeur rapide », « Variante : télémètre », 100 points chacun).
- seedReco() (v3ui/src/real-friends.js) les ajoute à « Mes loadouts » une seule fois chacun (clé pxv3-reco-ajoutes) : un build supprimé ne revient pas, un build de même nom ou de mêmes accessoires n'est pas doublé. Pas en mode démo.
- La classe vient de la catégorie de l'arme : BF6_ARMORY d'abord, sinon BF6_WEAPONS (bêta 34 : les fusils de précision ne sont pas dans BF6_ARMORY, le Mini Scout tombait en « assaut »).
- Vérifié par eng-work/reco34.cjs (profil neuf, et profil qui avait déjà reçu les sept autres).

## Montage : le moteur vidéo (depuis la bêta 32)
- Le moteur est FFmpeg (build LGPL de BtbN, sans libx264), livré tel quel dans resources/ffmpeg/ avec LICENSE.txt et SOURCE.txt. Player X le lance comme un programme à part : il n'est ni modifié ni lié à l'appli.
- Le build exact est épinglé dans src/shared/ffmpegPin.json (adresse, SHA-256 du zip et de ffmpeg.exe). scripts/fetch-ffmpeg.mjs le télécharge dans vendor/ffmpeg/ (pas dans git), le vérifie et refuse tout autre fichier. Pour changer de version : changer la fiche, rien d'autre.
- src/main/services/editFfmpeg.ts : vérifie l'empreinte du fichier avant de s'en servir (une fois par fichier), le lance sans interpréteur de commandes, en priorité basse, dans un dossier temporaire effacé à la fin. Rien ne tourne au démarrage.
- src/main/services/editEngineRules.ts (module pur, npm run test:edit) : lecture des réponses de ffmpeg, arguments, choix de l'encodeur (NVIDIA, AMD, Intel, encodeur de Windows, puis libopenh264), texte à copier sans aucun chemin du PC.
- Canaux edit:* (src/main/channels/edit.ts) : aucun argument ne vient de la page.
- Écran : Paramètres › Montage (v3ui/src/settings.js, pEdit). « Tester le moteur » essaie chaque encodeur sur 5 s de mire en 1080p60 : il marche ou non (cette mire ne dit pas de vitesse, le démarrage y pèse plus que le travail). Puis le meilleur passe sur le dernier clip par le chemin d'un vrai film (un plan de 20 s au plus, puis l'assemblage) : c'est lui qui dit la vitesse. Le résultat est gardé (clé editEngineTest) et sert à choisir l'encodeur des films.
- Sous Linux (développement) : PX_FFMPEG=/usr/local/bin/ffmpeg remplace le moteur, PX_FFMPEG_ENCODER=libx264 ajoute un encodeur qui marche sans carte graphique. Le ffmpeg.exe livré n'y est jamais lancé. Scénario : tools/essais-clips/t12-moteur.cjs.

## Montage : faire un film (depuis la bêta 33)
- Page Clips : « Faire le film » sur chaque groupe de deux clips ou plus. La page envoie les identifiants des clips affichés (editFilmStart) ; tout le reste se décide dans le processus principal. Le film est rangé avec les clips (kind « film »), dans le sous-dossier Films du dossier des clips : il ne compte pas dans la limite de place, ne part jamais tout seul, ne se coupe pas (il se refait depuis ses clips).
- src/main/services/editPlan.ts (pur) : la première règle de montage, « bout à bout ». Chaque kill garde 3 s avant et 1,2 s après (8 s et 1 s pour un clip gardé à la main), deux fenêtres à moins de 0,6 s se rejoignent, les clips se suivent dans l'ordre du match, 48 plans au plus. Les instants viennent des événements notés dans chaque clip (events, depuis la bêta 33) ; un clip plus ancien n'en a pas : son dernier kill se devine à « après » secondes de la fin.
- src/main/services/editCompile.ts (pur) : les commandes du moteur. Un film se fabrique plan par plan, un seul ffmpeg à la fois (mémoire constante, lignes de commande courtes, un plan raté se nomme) : chaque plan devient un fichier MOV (image H.264 encodée une fois pour toutes, son sans perte), puis un dernier passage met les morceaux bout à bout sans retoucher l'image et encode le son d'une traite (liste « ffconcat » lue dans le dossier de travail : aucun chemin du PC n'y est écrit). Les durées vont au pas de 3 images (50 ms à 60 images/s) : exactes en images, en échantillons de son et en microsecondes. Chaque option utilisée a été relue dans les sources de FFmpeg 9.0.2 (commit de la fiche) et retrouvée dans le fichier livré.
- src/main/services/editFilm.ts : la fabrication. Un seul film à la fois, jamais pendant qu'un jeu tourne, arrêt tout seul si un jeu démarre ; pas d'essai du moteur pendant un film, ni l'inverse. Encodeur : le dernier qui a fait un film, puis ceux de l'essai, puis les autres ; un plan raté est laissé de côté, deux de suite font passer à l'encodeur suivant. Avancement réel par « edit:film ». Un film raté donne un texte à copier, sans chemin. Dossier de travail px-film-* dans le dossier temporaire, effacé dans tous les cas.
- Format des films : 1920 × 1080, 60 images/s, 16 Mb/s, son AAC 192 kb/s (FILM et FILM_FORMAT dans editCompile.ts). Un clip d'une autre forme est remis à la taille avec des bandes noires.
- À savoir sur le son : un plan cale son son sur l'horodatage du clip à l'instant de la coupe, comme un lecteur qui s'y place. Dans les clips de l'enregistreur, cet horodatage se promène de quelques millisecondes autour du compte réel des échantillons (jusqu'à 20 ms mesurés) : c'est l'écart maximal entre le son d'un plan et celui du clip lu depuis son début. Les 80 premières millisecondes de son d'un clip (amorce du codec Opus) ne sont pas lues par FFmpeg.
- clips.ts exporte pour le montage : gameRunning, newestClipSource, filmSources (relit l'index MP4 de chaque clip : image présente, son ou non), clipAfterSetting, filmTarget, addFilm.
- Scénario : tools/essais-clips/t14-film.cjs (un vrai film de trois clips fait par l'appli avec le ffmpeg de la machine : chaque image comparée à celle du clip, écart son/image, refus, arrêt, jeu qui démarre, moteur qui rate tout, relais entre encodeurs).
- Pas encore fait : la musique (un fichier du PC, Player X n'en fournit pas), l'éditeur (écrans pour choisir et régler les plans), les effets, la clé Claude (elle ira dans Paramètres › Montage).

## Boutons (depuis la bêta 31)
- Une seule touche rose pour toute l'appli : --key (dégradé), --key-hi (survol) et --key-edge (relief), dans v3ui/src/base.css. Elle sert à .btn.rose, au « Jouer » du dock (play.css) et à .lo-dc-go (atelier.css). Pour changer le rose des boutons, c'est là, et seulement là.
- .btn = touche de verre aux coins arrondis (14 px, 12 px en .sm). .btn.bone et .btn.danger ont le même relief. Les pastilles rondes (.pill) restent pour les filtres.
- Une seule touche rose par écran : l'action principale.

## Reconstruire
1. npm ci
2. npm run dist (scripts/dist-v3.mjs : moteur vidéo, V3, types, tests, electron-vite, NSIS, installeur Go ; sortie dans dist/, ou un autre dossier en argument)
   Le moteur vidéo (169 Mo à télécharger, une fois) arrive par curl ; sans réseau : node scripts/fetch-ffmpeg.mjs <le zip déjà téléchargé>.
   Sous Linux : Wine (et un écran, Xvfb) pour NSIS, Go (/usr/local/go/bin) et llvm-rc pour l'installeur.

Contrôles seuls : npm run typecheck puis npm test. L'exe est verrouillé par les fusibles Electron (package.json › build.electronFuses) :
pas de mode Node, pas de NODE_OPTIONS ni --inspect, app.asar vérifié.

## Essais sous Linux (développement seulement, rien de cela n'existe une fois installé)
- saveSettings({demoMode:true}) + PX_LAUNCH_SIM, PX_CS2_SIM, PX_BF6_SIM, PX_NEWS_SIM, PX_READY_SIM, PX_SERVERS_SIM, PX_CS2_STATS_SIM.
- PX_CLIP_TEST_SOURCE=640x360 : une page animée à la place de l'écran. PX_CLIP_TEST_MIME : forcer un format. globalThis.pxClipsTest : piloter le moteur.
- allowDemo(!app.isPackaged) : installé, la démo est impossible.

- Scénarios : tools/essais (h.cjs + a1 à a18 : la vraie fenêtre sous Xvfb) et tools/essais-clips (moteur d'enregistrement ; un clip se garde par globalThis.pxClipsTest.saveNow()). Ils demandent Playwright, installé à part (pas dans package.json : une autre version ne trouverait pas son navigateur) ; Electron se lance depuis node_modules/electron.

## À vérifier sur un vrai PC Windows
- Capture en plein écran exclusif, encodeur matériel, son du jeu (loopback), AAC ou Opus, performances, copie vers Discord.
- Le journal (Paramètres > Enregistrement > Copier le journal) dit ce que le moteur a choisi.
- Le film (bêta 33) : le moteur livré (FFmpeg 9.0.2 pour Windows) n'a jamais tourné pendant le développement, seul un FFmpeg 6.1.1 sous Linux a fabriqué des films. À vérifier : « Faire le film » sur de vrais clips (image, son, durée), le temps mis, et le texte de « Copier le résultat » dans Paramètres › Montage après un essai avec un clip. Si un film rate, « Copier l'erreur » dit pourquoi.

## Montage : l'éditeur (depuis la bêta 35)
- Page Clips : « Monter un film » sur chaque groupe (dès un clip), dans le clic droit d'un clip, et après « Sélectionner ». Il ouvre l'éditeur (v3ui/src/edit.js, edit.css) au lieu de fabriquer tout de suite.
- Géométrie partagée (src/shared/editShots.ts, aussi dans window.Shared.editShots) : un plan = un instant d'ancrage (le kill, reculé de 0,3 s : retard du jeu), `lead` pas avant, `tail` pas après, ralenti ou non. Le pas = un temps de la musique (0,5 s sans musique). Le ralenti couvre un pas du clip à vitesse 0,5 (deux pas dans le film) : coupes et kills tombent sur un temps.
- Musique : fichier du PC choisi dans une fenêtre de Windows (editMusic.ts). Le moteur décode les 10 premières minutes (mono, 11 025 Hz, passe-bas 150 Hz), editBeats.ts trouve le tempo et la grille. Liste gardée dans la base (clé editMusic, 12 au plus) ; le chemin ne quitte jamais le processus principal. Développement : PX_MUSIC_PICK donne le fichier sans fenêtre.
- Projet (EditProject v2) : identifiants seulement, revu par editPlan.cleanProject (bornes, clips réels, musique connue, 48 plans, 10 min). editCompile.filmPieces arrondit les images sur la ligne du film entier (écart < 25 ms, qui ne s'additionne pas). Morceau ralenti : setpts=PTS/0.5 et atempo=0.5. Assemblage : musique mélangée (volume, fondu de 2 s, amix sans normalisation, alimiter).
- Les anciens appels avec des identifiants seuls (bêta 33) marchent encore (bout à bout).
- Vérifié : eng-work/ui-edit35.cjs (vraie fenêtre, vrais clips, ffmpeg de la machine, musique de synthèse à 128 BPM) ; filtres présents dans le ffmpeg.exe livré (lus dans le fichier, pas lancés). eng-work/ui-film.cjs (bêta 33) attend encore « Faire le film » : dépassé.

## Clips qui saccadent (bêta 36, essai)
- Mesuré sur deux clips de Breezydev (CS2, écran 2560×1440 ramené à 1920×1080, préréglage « équilibré » 60 i/s) : 12 puis 33 images/s en moyenne, 22 pendant l'action. Le jeu, lui, reste fluide.
- Journal de son PC : encodeur H.264 matériel « oui », mais format réel avc1.640029 (niveau 4.1, prévu pour du 1080p à 30 i/s ; ici sous Linux : 64002a, niveau 4.2). Piste à suivre.
- Bêta 36 : la piste vidéo de la capture porte contentHint = 'motion' (sans elle, Chrome traite l'écran comme du texte : il garde la netteté et sacrifie les images). Le journal écrit les images reçues, transmises et perdues par seconde (MediaStreamTrack.stats), toutes les 10 s la première minute puis chaque minute.
- Vérifié sous Linux (eng-work/fps36.cjs, vraie capture d'écran) : 58,7 à 59,2 reçues et transmises, 0 perdue, indication motion. Pas vérifié sur Windows.
- Bêta 36 sur le PC de Breezydev (journal du 10/11, 23 h 25) : images reçues de l'écran 26,8 à 50,7 par seconde, 0 perdue. Ce n'est pas l'encodeur : c'est la capture de l'écran. Clip « Quadruple » : 36,6 images/s, 13 à 19 à la fin.
- Bêta 37 : sous Windows, Chromium lancé avec enable-features=AllowWgcScreenCapturer (capture Windows.Graphics.Capture au lieu de DXGI ; désactivée par défaut dans Chromium, media/webrtc/webrtc_features.cc). La ligne « Jeu lancé » du journal écrit les fonctions actives. Pas vérifiable ici (Linux).
- Essais du 10/11 au soir (bêta 37, qualité haute, journal + clips) : sans limite d'images dans CS2 (336 i/s), 32 à 40 images/s dans les clips ; avec fps_max 144 : 53 images/s régulières ; avec fps_max 120 : 54,5 images/s (53 à 56 chaque seconde, plus long trou 38 ms). Cause : la carte graphique est prise par le jeu, la capture de Chrome n'a plus de place. Débit réel en qualité haute : 75 à 130 Mb/s pour 40 demandés.
- Bêta 38 : MediaRecorder avec videoBitrateMode 'constant' (pas vérifié sous Windows). Paramètres › Enregistrement › Essai : « Essayer la capture comme OBS » (captureTest.ts, captureTestArgs.ts) : 10 s pour revenir en jeu, puis 10 s par méthode avec le moteur (gfxcapture fenêtre du jeu, gfxcapture écran, ddagrab écran ; scale_d3d11 en NV12 ; h264_nvenc puis h264_amf ; priorité normale ; images comptées par -progress, dup_frames=0 pour ddagrab). Vidéos dans « Essais capture », résultat dans la ligne, un message et le journal. Commandes testées par captureTestArgs.test.ts ; jamais lancées (le moteur est un programme Windows).
- Bêta 38 sur le PC de Breezydev (11/11, 0 h 12) : les trois essais ratés en moins d'une demi-seconde à l'encodage (« Invalid argument », vidéos vides). Seule l'erreur du dernier encodeur (AMF, carte NVIDIA) était gardée. Clips habituels : 54 à 55 images/s régulières (fps_max 120), mais 84 à 137 Mb/s : le débit constant n'a rien changé.
- Bêta 39 : par méthode, six tentatives (NVENC puis AMF ; tout dans la carte avec périphérique créé par ffmpeg, sans périphérique imposé, puis copie par le processeur avant l'encodeur). Chaque échec écrit ses 6 dernières lignes dans le journal (niveau warning).
- Bêta 39 sur son PC (0 h 21) : les 18 tentatives échouent dans la chaîne d'image (fc#0, code -1313558101 « Unknown error »), avant l'ouverture de l'encodeur, même avec ddagrab et la copie. Pièce commune : scale_d3d11. Les premières lignes de l'erreur étaient coupées (une erreur gardée fait 400 caractères au plus).
- Bêta 40 : plus de scale_d3d11, image à la taille de l'écran (BGRA direct vers l'encodeur, ou hwdownload BGRA pour la copie). Chaque ligne d'erreur du moteur sur sa propre ligne du journal.
- Bêta 40 sur son PC (0 h 31) : l'essai marche. Fenêtre du jeu (gfxcapture) 54,9 images/s ; écran gfxcapture 55,4 ; écran ddagrab 58,9 (60 presque chaque seconde, plus long trou 50 ms). Débit 32 à 40 Mb/s (contre 84 pour Chrome). Limite fps_max du jeu pendant l'essai : à confirmer.
## Installeur (bêta 41)
- Barre bloquée à 68 % pendant ~11 s en mise à jour (le dossier a déjà sa taille) : la progression avance aussi avec le temps, 67 × (1 − e^(−t/τ)), τ = durée de la dernière copie sur ce PC ÷ 3 (fichier %LOCALAPPDATA%\<Slug>-installation.txt, 14 s par défaut). Reflet qui passe sur la barre (sauf mouvement réduit). Barre 4 px, texte 14 px.
- Écran vide avant « C'est à jour » : fondu en 0,35 s après 0,1 s (au lieu de 0,7 s de pause). Le mot « PLAYER X » reste sur tous les écrans. Étapes en mots clairs (« Installation des fichiers… »). Titre de la fenêtre « Mise à jour de … » pour une mise à jour.

## Clips filmés par le moteur vidéo (bêtas 42 et 43)
- Réglage `ClipSettings.capture` : `'engine'` (défaut) ou `'chrome'` (Paramètres › Enregistrement › Capture de l'image).
- src/main/services/engineCapture.ts : ordre des essais (fenêtre du jeu par gfxcapture → écran WGC → copie de bureau ddagrab ; NVENC puis AMF ; image dans la carte graphique, puis copiée), commande d'enregistrement (MP4 fragmenté sur la sortie standard, image clé toutes les 2 s), assemblage final (`muxArgs`), fenêtre de son (`pcmWindow`). Pas de scale_d3d11 (cassait la chaîne chez l'utilisateur).
- clips.ts : `startEngine`, `engineExited` (relance, manière suivante, retour à Chrome si rien ne marche), `writeEngineClip`. Le flux du moteur passe dans le même tampon que celui de Chrome.
- Son : la page cachée (clips-recorder.js, `startPcm`) lit le son en PCM 16 bits 48 kHz et le date avec `e.playbackTime` (pas en comptant les morceaux reçus : bêta 42 glissait de 400 ms). Le processus principal garde le PCM en mémoire ; à l'écriture d'un clip, le moteur assemble l'image copiée et le son encodé en AAC. Assemblage raté : clip sans son.
- Essais sous Linux : PX_ENGINE_SOURCE=x11 (x11grab + libx264 à la place de gfxcapture + NVENC), PX_FFMPEG=/usr/local/bin/ffmpeg. Mesure image/son : eng-work/ui-engine42.cjs (fenêtre qui flashe + bip toutes les 2 s).
- Mesuré chez l'utilisateur (CS2, 2560×1440) : 53 à 58 images/s dans les clips, contre 15 à 53 avec Chrome.

## GOG (bêta 43)
- src/main/services/gogInfo.ts : lecture de goggame-<id>.info (jeu de base seulement, exécutable principal, arguments, dossier de travail) et du registre GOG.com\Games. games.ts `scanGog` : registre, programmes installés, dossiers par défaut. Lancement direct par spawn (pas de Galaxy).
- À vérifier sur un vrai PC : jamais essayé sous Windows.
