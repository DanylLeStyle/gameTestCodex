# Crowd Cover
Prototype 3D multijoueur de cache-cache dans une foule. Node.js 20+ et navigateur de bureau avec WebGL. Three.js pour l'affichage, WebSocket pour un serveur autoritaire à 20 Hz. Aucun compte, asset externe ou clé API nécessaire.

## Lancer
```sh
npm ci
npm start
```
Le serveur écoute sur le port 3000 (modifiable avec `PORT`). Sur la machine hôte, ouvrir `http://localhost:3000`. Pour jouer à plusieurs, ouvrir `http://ADRESSE_IP_DU_SERVEUR:3000` depuis les autres ordinateurs du même réseau et autoriser ce port dans le pare-feu. Deux onglets permettent aussi un essai local. Pour Internet, prévoir un hébergement compatible WebSocket et HTTPS ; aucune publication automatique n'est incluse.

Le premier connecté devient chasseur (vue subjective), les suivants deviennent infiltrés (troisième personne). Cliquer sur « Entrer » capture la souris ; Échap la libère. ZQSD ou WASD pour bouger, souris pour regarder. Chasseur : clic pour capturer la silhouette visée, G pour provoquer la panique à sept mètres (recharge huit secondes), R pour relancer la manche. Infiltrés : E maintenu pour imiter une interaction, Espace maintenu pour paniquer. Le chasseur observe les réactions : aucun marquage automatique des infiltrés. Toucher un civil donne dix secondes supplémentaires aux infiltrés. Ils gagnent à la fin du temps, le chasseur gagne s'il les capture tous.

## Vérifier
```sh
npm test
```
Tests des rôles, déplacements, panique, captures, pénalités et fin de manche. Vérification visuelle à faire dans deux navigateurs : caméras, capture de souris, fluidité, lisibilité et plaisir de jeu.

## Limites du prototype
Une seule salle partagée, pas de matchmaking, comptes, reconnexion ni protection anti-triche de production. Les nouveaux arrivants rejoignent la manche en cours. Foule simple avec déplacements et animations procédurales ; les interactions sont mimées sur place. Le côté « goofy » vient des animations de panique : pas encore de ragdolls ou de simulation physique des collisions. La place est volontairement dégagée. Les modèles et sons pourront être intégrés ensuite. Ce prototype n'importe pas les Blueprints Unreal.
