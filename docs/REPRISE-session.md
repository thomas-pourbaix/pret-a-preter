# Échéancier de prêt — brief de reprise de session

> Document d'amorçage pour une nouvelle session Claude Code. Autoportant : il ne suppose
> aucun accès aux conversations précédentes. Écrit le 16 août 2026.

---

## 1. Où en est le projet

Application web statique **en production** : <https://thomas-pourbaix.github.io/loan-schedule/>

Elle résout le **taux** d'un prêt amortissable à partir du capital, de la durée et du coût
cumulé — l'inverse de ce que font la plupart des calculateurs — puis déroule l'échéancier
et l'exporte.

| | |
|---|---|
| Dépôt local | `/Users/thomaspourbaix/Claude_workspace/Perso/Prêts entre particuliers/appli_calcul_mensualités` |
| Dépôt distant | <https://github.com/thomas-pourbaix/loan-schedule> (public, AGPL-3.0) |
| Branche de travail | `feat/loan-schedule` — **non fusionnée** dans `main` |
| Pages sert | la branche `feat/loan-schedule`, racine |
| Tests | 161, tous verts (`npx vitest run`) |
| Dernier commit | `f5f145c` |
| Répertoire de travail | **modifications non commitées** : les cinq retours d'interface du §7 |

Le chemin local contient des accents et des espaces : **le quoter systématiquement** en bash.

---

## 2. Architecture

Modules ES natifs, **aucun bundler, aucune étape de build**. Ce qui est dans le dépôt est
ce qui est servi, ce qui supprime le piège des chemins absolus sur GitHub Pages.

```
index.html          page unique (markup + CSS + polices vendorisées)
src/core/           calcul pur, sans DOM — finance.js, format.js
src/export/         csv.js, xlsx.js
src/ui/             app.js (câblage), chart.js (2 graphiques), table.js
vendor/             write-excel-file 4.1.1 + IBM Plex, avec leurs licences
tests/              finance.test.js, export.test.js
docs/               SPEC-echeancier-pret.md (la référence), ce fichier
```

`package.json` n'existe **que pour les tests** (Vitest + deux oracles tiers en
`devDependencies`). Rien de ce que npm installe ne part sur Pages.

Serveur local — indispensable, les modules ES ne se chargent pas en `file://` :

```bash
python3 -m http.server 4173
```

---

## 3. Contraintes non négociables

- **Jamais de ligne `Co-Authored-By`** ni de mention d'outil dans les messages de commit.
- Code, fichiers, commentaires, messages de commit **en anglais**. Interface **en
  français**, formats `fr-FR`.
- **Aucune requête vers un tiers** depuis la page. Polices et bibliothèque d'export sont
  vendorisées ; la page l'affirme en pied de page, donc c'est à vérifier dans le journal
  réseau après toute modification.
- Chemins relatifs (`./src/…`), jamais de `/` initial.
- La suite de tests reste entièrement verte. Tout ajout vient avec ses tests.
- `docs/SPEC-echeancier-pret.md` est **vivant** : quand une convention change, on l'annote
  avec la date plutôt que de réécrire l'historique en silence.

---

## 4. Ce que fait l'application aujourd'hui

**Résolution inverse** par encadrement puis dichotomie. Le choix de ne pas réutiliser une
fonction `RATE` de bibliothèque est délibéré : celles des tableurs (Formula.js) renvoient
leur dernière itérée **sans rien signaler** quand elles ne convergent pas. Elles servent
d'oracles de test, pas de moteur.

**Mensualité en euros ronds** (par défaut). Toutes les échéances rigoureusement
identiques, en euros entiers, prêt soldé à `0,00 €`. Possible parce que le taux est
continu alors que le solde final ne prend que des valeurs en centimes : les taux qui
soldent exactement forment un intervalle.

**Marges de négociation.** Deux champs « marge ± » : sur la somme prêtée (qui se négocie
par tranches de 100 €) et sur le taux ou le coût. Le mode euros ronds gagne alors trois
degrés de liberté au lieu d'un. En cas d'échec, les deux concessions possibles sont
chiffrées séparément.

**Inflation**, 2 % par défaut. Lecture supplémentaire en euros constants du départ ; les
montants nominaux restent l'affichage principal.

**Deux graphiques**, tous deux en escalier : composition de chaque échéance (bâtons
jointifs, intérêts/capital) et extinction de la dette (avec les versions déflatées en
pointillés).

**Exports** CSV et XLSX (valeurs, pas de formules — hors périmètre), volets figés.

---

## 5. Pièges rencontrés, à ne pas redécouvrir

**Le cache de GitHub Pages.** `cache-control: max-age=600` s'applique aux modules ES
**indépendamment** du HTML. On peut donc servir un `index.html` neuf avec un `app.js`
vieux de dix minutes, et voir une interface incohérente. Ça a produit deux fausses pistes.
Avant de conclure quoi que ce soit sur un affichage :

```bash
diff <(curl -sS https://thomas-pourbaix.github.io/loan-schedule/src/ui/app.js) src/ui/app.js
```

**Le bundle `write-excel-file` sous Node.** `node -e` ne déclenche pas la branche UMD qui
pose le global. Il faut un vrai fichier `.cjs` ou `createRequire` ; le bundle expose alors
`globalThis.writeXlsxFile`, et `.toBlob()` fonctionne hors navigateur.

**Les indices d'élargissement ne doivent pas s'appeler eux-mêmes.** `searchSolutions` est
séparée de `solveWithinTolerances` pour cette raison : la version publique construit des
indices quand elle échoue, et si les indices la rappellent, l'ensemble se replie
exponentiellement sur lui-même. Un test verrouille le temps de réponse.

**Trois vrais bugs ont été trouvés en creusant des symptômes mineurs** — une valeur qui
paraît bizarre mérite qu'on creuse, pas qu'on l'ajuste :

- le solveur rendait le milieu du dernier encadrement au lieu du point mesuré (invisible
  en convergence lente, faux d'un facteur notable pour `n = 1`) ;
- le solde final continuait à courir après extinction de la dette, inversant la monotonie
  sur laquelle repose toute la dichotomie ;
- INV-004 énonçait une borne de cinq centimes qui n'est pas un théorème.

---

## 6. Ce qui reste ouvert

1. **Fusionner `feat/loan-schedule` dans `main`**, puis basculer Pages :
   ```bash
   gh api -X POST repos/:owner/loan-schedule/pages -f source[branch]=main -f source[path]=/
   ```
2. **Saisir directement la mensualité voulue.** Le coût saisi n'est plus vraiment une
   entrée en mode euros ronds : il sert à viser une mensualité, qui détermine ensuite le
   coût. Un troisième bouton « je choisis la mensualité » serait plus honnête —
   « je veux payer 1 000 € par mois pendant 20 ans, ça fait quel taux ? ».
3. **Numéro de version en pied de page**, pour savoir d'un coup d'œil si l'on regarde la
   dernière version déployée (voir le piège du cache).
4. **Valeurs par défaut des marges** : actuellement ±0, donc la fonctionnalité est inerte
   tant qu'on ne la règle pas. Choix conservateur assumé, à réévaluer à l'usage.
5. Hors périmètre v1, mentionné pour mémoire : assurance emprunteur, remboursements
   anticipés, différé d'amortissement, taux variable, prêts in fine, paliers de mensualité.

---

## 7. Retours d'interface du 16 août 2026, traités

Thomas a relu la page déployée et relevé cinq points. **Les cinq sont corrigés** dans le
répertoire de travail : 161 tests toujours verts, rendu vérifié dans le navigateur en
1280 px et en 375 px, console vide. Ces modifications ne sont **pas encore commitées** ni
déployées au moment où ces lignes sont écrites — la page en ligne montre encore l'ancienne
version.

Les fichiers touchés : `index.html`, `src/ui/app.js`, plus `README.md` et
`docs/SPEC-echeancier-pret.md` — §3.3 de la spec porte l'annotation datée du retrait de
l'équation et de l'arrondi d'affichage, conformément à la règle du §3 (une convention qui
change s'annote, elle ne se réécrit pas en silence). Aucun fichier de `src/core` n'a bougé :
rien de ce qui suit ne touche au calcul.

### 7.1 Les cumuls s'affichent à l'euro

La tuile « Coût total des intérêts » affichait `51 999,96 €` suivi de
`−0,04 € vs hypothèse (arrondis au centime)`. À l'échelle d'un prêt de 200 000 €, quatre
centimes ne renseignent personne : c'est du bruit qui coûte une ligne de lecture.

Ce qui a changé, dans `src/ui/app.js` uniquement :

- coût total, coût et total versé en euros constants, coût cité dans la note de marge et
  dans la note d'euros ronds : `formatEuro` → `formatEuroRounded` ;
- `describeDrift` se tait sous 0,50 € — en dessous, l'écart ne change pas le nombre
  affiché au-dessus — et exprime l'écart en euros ronds au-delà. En mode « coût choisi »
  l'écart d'arrondi est toujours sous le seuil, donc la sous-ligne dit désormais
  « conforme à l'hypothèse saisie » ; en mode euros ronds l'écart reste affiché
  (`+240 € vs hypothèse (mensualité ronde)` sur les valeurs par défaut).

Décisions à connaître avant de toucher à ça :

- **la mensualité garde ses centimes** hors mode euros ronds : c'est le montant réellement
  viré chaque mois, pas un cumul ;
- l'arrondi est un choix **d'affichage** — calcul, échéancier et exports CSV/XLSX restent
  au centime ;
- le pied de page promettait un écart affiché sans condition ; la promesse a été reformulée
  au lieu d'être laissée fausse (`index.html`, liste des conventions). Si le seuil bouge,
  cette phrase bouge avec.

### 7.2 Bandeau statique

Le bandeau basculait entre « un taux résolu » et « un coût déduit » selon le mode, piloté
par une constante `MASTHEAD` et une fonction `renderMasthead` dans `app.js`. Les deux ont
été supprimées, ainsi que les `id` correspondants dans le markup ; `toggleMode` ne fait
plus que montrer ou cacher le bon champ.

Le texte dit maintenant à quoi sert l'outil, et le nomme pour ce qu'il est : un
instrument de **prêt entre particuliers** — deux personnes qui s'accordent sur une somme,
une durée et un coût, et qui ont besoin d'un échéancier tenable. Le `<meta
name="description">` a été repris dans le même sens. L'étiquette de mode du panneau
Résolution (`#mode-tag`) reste dynamique : c'est là que l'information de mode a sa place.

### 7.3 Ligne d'équation supprimée

`M = P × i ⁄ ( 1 − (1 + i)⁻ⁿ )` et sa substitution numérique ne parlaient pas à
l'utilisateur, et allaient pourrir à mesure que le calcul évolue — c'était déjà faux
d'esprit en mode euros ronds, où le taux n'est pas ce qui produit la mensualité mais ce
qui s'y ajuste. Markup, remplissage de `#substituted` et règles CSS `.equation` /
`.substituted` sont partis ; `.solved` a perdu son `margin-top` puisqu'il ouvre désormais
le panneau. `formatNumber` reste importé, il sert encore ailleurs.

### 7.4 Aide du champ « Taux annuel nominal »

Question posée : que voulait dire cette histoire de taux actuariel ?

La réponse, pour mémoire. Le taux mensuel appliqué vaut `taux annuel ⁄ 12` — la convention
**proportionnelle**, celle des offres de prêt françaises. À 2,45 % nominal, le taux mensuel
est 0,204 17 % et le taux **équivalent** (dit aussi actuariel), `(1 + i)¹² − 1`, vaut
2,478 %.

Attention au sens qu'on lui donne : l'équivalent n'est **pas** ce que l'emprunteur paie.
Sur un prêt amortissable il règle ses intérêts en cash à chaque échéance, rien ne se
capitalise côté dette, et l'intérêt décroît avec le capital restant dû — sur 10 000 € à
12 mois il paie 133,20 €, et 2,478 % n'apparaît dans aucun de ses flux. Cet écart est le
TRI des flux du **prêteur** : celui qui replace chaque mensualité de 844,43 € au même taux
mensuel termine l'année avec 10 247,77 €, soit 10 000 × 1,024 777. Sa lecture économique
est donc l'hypothèse de réinvestissement des mensualités ; son utilité pour l'emprunteur
est de comparer des offres cotées sur des périodicités différentes, pas de mesurer son
décaissement.

Conclusion retenue : on ne tente pas d'expliquer ça dans l'interface, on simplifie.
L'aide du champ énonce la règle (÷ 12) et s'arrête là — la phrase sur les douze mois
composés est retirée, ainsi que la ligne du pied de page qui donnait la formule de
l'équivalent. Le pied de page garde la seule convention proportionnelle. Le taux
équivalent reste affiché dans la sous-ligne `#out-rate-sub`, où il est nommé, et dans
l'onglet des hypothèses du tableur.

### 7.5 Libellés de la bascule

« Je connais le coût » → **« Je choisis le coût de l'emprunt »**, « Je connais le taux » →
**« Je choisis le taux »** : on ne constate pas une donnée, on décide laquelle des deux on
fixe. L'`aria-label` du groupe radio suit (« Donnée que vous fixez »).

Le premier libellé passe sur deux lignes dans la colonne de 340 px. Les deux moitiés
gardent la même largeur ; `.switch label` est devenu un conteneur flex centré pour que le
libellé long soit centré verticalement au lieu de pendre en haut de sa case. Vérifié à
375 px : les deux cases font la même hauteur, pas de débordement horizontal.

### 7.6 Ce que ces retours laissent ouvert

- La sous-ligne du coût dit « (arrondis au centime) » quand un écart dépasse le seuil en
  mode « coût choisi ». Avec des marges de négociation actives, l'écart peut venir de la
  marge acceptée et non de l'arrondi : la cause affichée serait alors inexacte. Le cas
  n'est pas atteignable en pratique aujourd'hui (la note de marge dit déjà le coût retenu),
  mais la ficelle est là.
- Reste à décider si le bandeau doit dire un mot du cadre juridique (reconnaissance de
  dette, déclaration au-delà de 5 000 €). Volontairement absent : ce n'est pas un conseil
  que cet outil est en mesure de donner.

---

## 8. Pour démarrer

Lire dans l'ordre : ce fichier, puis `README.md` (ce que fait l'outil et pourquoi), puis
`docs/SPEC-echeancier-pret.md` §4 (conventions de calcul) et §6 (les dix invariants).
Lancer `npx vitest run` pour vérifier que le socle est sain avant de toucher à quoi que ce
soit.
