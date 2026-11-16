// Clés publiques (Ed25519, format PEM « SPKI ») qui ont le droit de signer maj.json.
// VIDE : la mise à jour dans l'appli est coupée (rien n'est vérifié, rien n'est proposé ; Paramètres › À propos le dit).
// `npm run maj:cle` crée la paire de clés (la clé privée reste sur ton PC, hors du dépôt) et ajoute la clé publique ici.
// Plusieurs clés : une ancienne peut rester le temps de passer à une nouvelle.
export const UPDATE_KEYS: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAsE9FqykThj3fwaJo0YmYxqJD6adOmSOpM32JSX0Ugiw=
-----END PUBLIC KEY-----
`
]
