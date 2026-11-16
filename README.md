# Player X

Player X est un lanceur de jeux pour Windows. Il réunit les jeux du PC, les lance, enregistre des clips, en monte des
films et affiche un overlay pendant les parties de Counter-Strike 2.

Il ne se met pas encore à jour tout seul : une nouvelle version s'installe par-dessus.

![Page d'accueil de Player X](docs/captures/accueil.jpg)

## Installer l'appli

Lancer `Player-X-Installer-<version>.exe` (ou `Player-X-Setup-<version>.exe`) sous Windows 10 ou 11.
Rien d'autre à installer : tout ce dont l'appli a besoin, FFmpeg compris, est livré dedans.

## Licences

- FFmpeg 9.0.2, utilisé pour le montage et livré tel quel avec l'appli : GNU LGPL v3 ou ultérieure. Version exacte fixée
  dans `src/shared/ffmpegPin.json`.
- Polices : licences dans `v3ui/fonts/licences/`.

## Contribution

Rien n'est poussé sur ce dépôt sans l'accord de Breezydev.

## Documentation technique

`docs/ARCHITECTURE.md` (fonctionnement de l'appli) et `NOTES.md` (construction et livraison).
