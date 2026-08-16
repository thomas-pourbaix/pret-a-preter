# Échéancier de prêt — brief de reprise de session

> Document d'amorçage pour une nouvelle session Claude Code. Autoportant : il ne suppose
> aucun accès aux conversations précédentes. Écrit le 16 août 2026, mis à jour le même
> jour après le **troisième** tour de retours d'interface (§8).

---

## 1. Où en est le projet

Application web statique **en production** : <https://thomas-pourbaix.github.io/loan-schedule/>

Deux personnes s'accordent sur une somme, une durée et ce que l'emprunt coûtera — un taux
ou un cumul d'intérêts. L'outil part de l'un ou de l'autre, en tire une **mensualité en
euros ronds**, déroule l'échéancier et l'exporte.

| | |
|---|---|
| Dépôt local | `/Users/thomaspourbaix/Claude_workspace/Perso/Prêts entre particuliers/appli_calcul_mensualités` |
| Dépôt distant | <https://github.com/thomas-pourbaix/loan-schedule> (public, AGPL-3.0) |
| Branche de travail | `feat/loan-schedule` — **non fusionnée** dans `main` |
| Pages sert | la branche `feat/loan-schedule`, racine |
| Tests | 170, tous verts (`npx vitest run`) |
| Dernier commit | `7a42bec`, poussé — la page en ligne montre cet état |
| Répertoire de travail | **modifications non commitées** : les tours de retours §7 et §8 |

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

**Mensualité en euros ronds — la seule convention**, plus une option. Toutes les échéances
rigoureusement identiques, en euros entiers, prêt soldé à `0,00 €`. Possible parce que le
taux est continu alors que le solde final ne prend que des valeurs en centimes : les taux
qui soldent exactement forment un intervalle. Quand aucune mensualité ronde ne convient,
même en s'écartant de 24 €, le calcul retombe sur la convention bancaire — mensualité au
centime, dernière échéance ajustée — et le dit à l'écran. Le noyau garde les deux chemins
(`solveLoan` conserve son paramètre `roundPayment`, tous deux testés) ; c'est l'interface
qui ne propose plus le choix.

**Bilan à deux colonnes**, « souhaité » et « contractualisé », une ligne par terme du prêt.
C'est la conséquence directe du point précédent : la mensualité ronde déplace la somme
prêtée, le taux et le coût par rapport à ce qui a été saisi, donc afficher le seul résultat
réécrirait l'hypothèse en silence. Voir §7.1.

**Marges de négociation.** Deux champs « marge ± » : sur la somme prêtée (qui se négocie
par tranches de 100 €) et sur le taux ou le coût. La recherche gagne alors trois degrés de
liberté au lieu d'un. En cas d'échec, les deux concessions possibles sont chiffrées
séparément.

**Inflation**, 2 % par défaut, sous une case « vision inflation » qui commande d'un bloc le
bloc du bilan, les pointillés du graphique et les colonnes correspondantes des exports.
Lecture supplémentaire en euros constants du départ ; les montants nominaux restent
l'affichage principal.

**Deux graphiques**, tous deux en escalier : composition de chaque échéance (bâtons
jointifs, intérêts/capital) et extinction de la dette (avec les versions déflatées en
pointillés, nommées en légende).

**Exports** CSV et XLSX (valeurs, pas de formules — hors périmètre), volets figés, mise en
page du classeur calculée à partir des données (§8.1).

**Champs à pas.** Somme empruntée par tranches de 100 €, taux par pas de 0,05 point,
marges comprises : une saisie intermédiaire est ramenée au plus proche à la sortie du
champ. Boutons d'incrément fin et grossier sur chacun.

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

**Les règles CSS globales du tableau d'échéancier mordent sur toute autre table.**
`table`, `thead th` (collant, aligné à droite, capitales) et `tbody td` sont écrits sans
classe. Le bilan du §7.1 doit donc surclasser chacune d'elles explicitement
(`.balance td.wish`, pas `.balance .wish`) : à spécificité égale, c'est l'ordre dans la
feuille qui tranche, et le bloc de l'échéancier vient après celui de la résolution.

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
2. **Certificat de dette généré par l'application.** Annoncé par Thomas comme la suite : le
   bilan « souhaité / contractualisé » du §7.1 est précisément ce qui doit s'y retrouver.
   Rien n'est écrit à ce sujet, ni périmètre ni format ; à cadrer avant d'écrire du code.
   Le cadre juridique (reconnaissance de dette, déclaration au-delà de 5 000 €) redevient
   alors une question ouverte, jusqu'ici volontairement laissée hors de l'outil.
3. **Saisir directement la mensualité voulue.** Devenu plus criant depuis que la mensualité
   ronde est la seule convention : le coût saisi ne sert plus qu'à viser une mensualité,
   qui détermine ensuite le coût réel. Un troisième bouton « je choisis la mensualité »
   serait plus honnête — « je veux payer 1 000 € par mois pendant 20 ans, ça fait quel
   taux ? ».
4. **L'onglet « Hypothèses » du tableur n'a pas suivi le bilan.** Il annonce le capital
   comme « saisi » alors qu'une marge active peut l'avoir déplacé (`solved.principal` vs
   `solved.requestedPrincipal`), et il ne porte pas les deux colonnes. À reprendre avec le
   point 2, dont il est la matière première.
5. **Numéro de version en pied de page**, pour savoir d'un coup d'œil si l'on regarde la
   dernière version déployée (voir le piège du cache).
6. **Valeurs par défaut des marges** : actuellement ±0, donc la fonctionnalité est inerte
   tant qu'on ne la règle pas. Choix conservateur assumé, à réévaluer à l'usage.
7. Hors périmètre v1, mentionné pour mémoire : assurance emprunteur, remboursements
   anticipés, différé d'amortissement, taux variable, prêts in fine, paliers de mensualité.

---

## 7. Second tour de retours d'interface, 16 août 2026

Le **premier tour** (cinq points : cumuls affichés à l'euro, bandeau statique, ligne
d'équation supprimée, aide du champ « taux », libellés de la bascule) est **commité et
déployé** — tout est dans `7a42bec`, dont le message de commit et les annotations datées du
SPEC portent le raisonnement. Il n'est plus repris ici.

Ce qui suit est le **second tour**, encore dans le répertoire de travail : 161 tests
toujours verts, rendu vérifié en 1280 px et en 375 px, console vide, journal réseau sans
aucune requête tierce. Fichiers touchés : `index.html`, `src/ui/app.js`, plus `README.md`
et `docs/SPEC-echeancier-pret.md`. **Aucun fichier de `src/core` n'a bougé** : rien de ce
qui suit ne touche au calcul.

### 7.1 Le bloc de résolution devient un bilan

Demande : « affiche ça sous forme de bilan qui compare les hypothèses (souhaits) et qui dit
ce qu'on a à la fin (ce qui va être contractualisé) ». Motif donné : c'est ce qui ira dans
le certificat de dette que l'application doit générer (§6.2).

Les trois tuiles (mensualité, taux, coût) et les deux notes en prose qui les rattrapaient
sont remplacées par un **tableau à deux colonnes** — souhaité, contractualisé — avec une
ligne par terme du prêt : somme prêtée, durée, mensualité, taux annuel nominal, coût total
des intérêts, total remboursé. Rendu par `renderBalanceSheet` dans `app.js`, styles `.balance`
dans `index.html`.

Décisions à connaître avant d'y toucher :

- **L'écart n'est affiché que s'il se voit.** `describeGap` compare `gapFormat(|écart|)` à
  `gapFormat(0)` et se tait quand les deux coïncident. C'est la généralisation propre du
  seuil de 0,50 € du premier tour : les deux colonnes sont déjà arrondies pour l'affichage,
  donc un écart qui s'imprime « 0 € » contredirait les deux chiffres qu'il commente. Chaque
  ligne apporte son format, ce qui règle du même coup le cas du taux (en points).
- **La colonne « souhaité » n'est pas toujours une saisie.** En mode coût, le taux est
  l'inconnue (`—`, sous-ligne « l'inconnue ») et la mensualité est déduite ; en mode taux,
  c'est le coût qui est déduit. Chaque case le dit sous elle, plutôt qu'une légende.
- Les diagnostics du solveur (itérations, résidu, solde final, échéances ajustées) restent
  sous le bilan : ce sont des preuves, pas des termes du contrat.
- La note de marge ne répète plus les chiffres du tableau ; elle ne dit que ce qu'aucune
  colonne ne peut dire (« 2 combinaisons convenaient »). La note d'euros ronds ne subsiste
  que pour son **échec** — `renderRoundWarning` — puisque le succès est désormais lisible
  ligne à ligne.

### 7.2 Les euros ronds deviennent la seule convention

« mets tout en euros ronds, la case devient obligatoire ». La case à cocher est retirée,
`app.js` passe `roundPayment: true` en dur. Le repli bancaire subsiste dans le noyau et
reste testé ; l'étiquette de mode passe à « mensualité ronde impossible » quand il
s'applique, et une note l'énonce.

Conséquence sur la rédaction, qui est le vrai travail ici : **toute phrase qui présentait
l'arrondi au centime et la dernière échéance ajustée comme le cas normal était fausse.**
Corrigées dans le pied de page (deux puces désormais : la convention, puis le repli), dans
le README et dans le SPEC — §4.3 porte l'annotation qui le rétrograde en repli, §4.3 bis
celle qui dit qu'il n'est plus un mode.

**Quand le repli se déclenche, mesuré et non supposé.** Balayage de 504 combinaisons
(8 capitaux × 9 durées × 7 taux) : **7 échecs, tous sur le même prêt** — 500 € sur 240 mois,
à chacun des sept taux essayés. La mensualité idéale y vaut 2,08 € à 5,51 €, et la grille
des euros entiers est alors trop grossière pour le prêt : 2 € × 240 ne couvrent même pas le
capital, et les mensualités entières au-dessus font sauter le solde par-dessus zéro. Tous
les autres cas trouvent une mensualité ronde. Le repli concerne donc les **petits prêts sur
longue durée**, pas les prêts hors normes — et il reste rare.

### 7.3 Bandeau et sous-lignes

- Titre : « chiffré ligne à ligne » était obscur — la formule voulait dire « une ligne par
  échéance ». Remplacé par **« chiffré échéance par échéance »**.
- Chapô : « reste à savoir quel taux cela représente » était faux, puisque « ce que
  l'emprunt coûtera » **est** le taux ou le cumul d'intérêts. Consigne explicite de Thomas :
  ne pas rendre la phrase dynamique, mais la rendre **assez générale pour rester vraie quelle
  que soit l'option retenue**. Elle dit maintenant « un taux, ou un cumul d'intérêts. Cet
  outil part de l'un ou de l'autre » — ce qui répare du même coup le mode taux, passé sous
  silence dans la version précédente.
- `, sans exception` après la mensualité, et la sous-ligne `mensuel 0,20422 %` : supprimés
  avec les tuiles. Le taux mensuel vaut `taux annuel / 12` et la conversion est en pied de
  page ; l'afficher ne renseignait personne.

### 7.4 Ce que ce tour laisse ouvert

- Le point §6.4 (l'onglet « Hypothèses » du tableur) est né de ce tour : l'écran distingue
  désormais montant souhaité et montant retenu, le classeur non.
- Le libellé de colonne « Contractualisé » engage l'outil sur un terrain juridique où il
  n'a encore rien à dire (§6.2). C'est assumé tant que le certificat de dette n'existe pas,
  mais c'est à revoir quand il existera.

---

## 8. Troisième tour de retours d'interface, 16 août 2026

Source : un PDF de captures annotées (`feedbacks appli calcul prêt.pdf`), plus une demande
orale sur la lisibilité du classeur exporté. Onze remarques en tout. Toutes traitées ;
170 tests verts, rendu vérifié en 1280 px et en 375 px, console vide, journal réseau sans
aucune requête tierce. Fichiers touchés : `index.html`, `src/ui/app.js`, `src/ui/chart.js`,
`src/export/xlsx.js`, `src/export/csv.js`, `tests/export.test.js`, plus `README.md` et
`docs/SPEC-echeancier-pret.md`. **`src/core/` n'a toujours pas bougé** : rien de ce tour ne
touche au calcul.

### 8.1 Le classeur exporté était juste et illisible

C'est le gros du travail. En-têtes tronqués, colonnes deux fois trop larges pour leurs
chiffres, aucun repère horizontal sur 240 lignes.

**La cause de l'illisibilité des en-têtes, à ne pas redécouvrir :** les libellés étaient
déjà déclarés `wrap: true`, mais **un tableur qui n'a pas reçu de hauteur de ligne garde
la hauteur d'une ligne et rogne tout le reste**. `write-excel-file` accepte une propriété
`height` par cellule et retient le maximum de la ligne — c'est cette propriété qui
manquait, pas le repli. Vérifiable dans le XML produit : `<row r="1" ht="51"
customHeight="1">`.

Le reste de la mise en page est **calculé**, pas choisi à la main (`fitColumns`,
`headerHeight`, `dress` dans `src/export/xlsx.js`), ce qui la rend juste quel que soit le
prêt exporté : largeur = max(plus large chiffre imprimé, plus long mot insécable de
l'en-tête) + 2 ; au-delà de trois lignes d'en-tête la colonne s'élargit d'un caractère à la
fois plutôt que de faire une tour ; valeurs centrées sur les deux axes ; une ligne sur deux
teintée. Mesurer un chiffre veut dire mesurer ce qui sera **imprimé** — séparateurs de
milliers, décimales, signe, `%` — pas la valeur brute : voir `numberWidth`.

Deux pièges rencontrés :

- **Une phrase pleine largeur ne doit pas fixer la largeur de sa colonne.** L'avertissement
  « ce n'est pas un TAEG » vit en colonne A de l'onglet `Hypothèses` et est censé déborder
  sur les cellules vides à sa droite. D'où le paramètre `measured` de `sheet()`, qui exclut
  ces lignes du calcul de largeur.
- **L'ordre des propriétés dans `dress()` est significatif.** Le fond et le centrage sont
  posés *avant* l'étalement de la cellule, pour qu'une cellule qui a déclaré son propre
  alignement (les colonnes de prose, au fer à gauche) l'emporte.

### 8.2 Les diagnostics permanents sautent

« inutile. Vire. ça doit toujours être égal à zéro » (la ligne « Aucune échéance ajustée ·
solde final 0,00 € ») et « ne laisse pas entendre à l'utilisateur qu'il avait avant le
choix de cocher la case euro rond ». Ce sont deux fois le même problème : ces mentions sont
des **invariants**, et « aucune échéance ajustée » se lisait comme le résultat d'une option
réussie alors que rien n'a jamais été coché. Ligne supprimée, `chip()` avec ; l'étiquette
de mode passe de « mensualité ronde impossible » à « repli bancaire ».

Corollaire demandé — « si tu ne trouves pas de solutions, dis-le à l'utilisateur » : ce qui
reste sous le bilan est exclusivement un rapport d'échec, dans une région `aria-live`
(`#diagnostics`). Les quatre notes existaient déjà, elles étaient noyées.

### 8.3 Les champs se saisissent par pas, et le solveur attend une pause

« l'application rame quand on modifie ce champ » sur la marge du capital, et « interdis de
mettre des sommes qui ne sont pas des multiples de 100 », « arrondis au plus proche »,
« pareil pour le taux ». Trois demandes, une seule cause : le solveur repartait à chaque
frappe, sur des nombres en cours de saisie que personne n'avait voulus.

- **Table `STEPPED` dans `app.js`.** `step` = quantum imposé (100 € sur le capital, 0,05
  point sur le taux, marges comprises), `buttons` = incréments proposés. Le **coût cumulé
  garde sa liberté** : ce n'est pas une somme que quelqu'un vire, et 1 587 € est voulu.
- **Le quantum s'applique dans `readInputs`**, pas seulement à l'affichage : le moteur ne
  voit jamais un montant interdit. `normalise()` réécrit le champ à sa sortie, ce qui rend
  la correction visible au lieu de la faire en douce.
- **Anti-rebond de 280 ms sur la frappe** ; valider un champ ou cliquer un incrément
  recalcule tout de suite. Le bilan s'estompe (`[data-pending]`) tant qu'une frappe n'a pas
  été prise en compte, pour qu'une pause ne se lise pas comme un abandon.

### 8.4 Valeurs par défaut, et la vision inflation

- **10 000 € sur 10 ans, coût 1 587 €** (le taux affiche 3,00 %). 200 000 € sur 20 ans
  décrivait un prêt immobilier bancaire, pas ce que l'outil sert. Les 1 587 € sont bien
  « l'équivalent en coût cumulé » de 3 % demandé par Thomas : `periodicPayment(10000,
  0,03/12, 120) × 120 − 10000 = 1 587,29`.
- **« c'est quoi ces pointillés »** : les courbes déflatées n'étaient nommées nulle part.
  Entrée de légende ajoutée, avec un fanion réellement pointillé (dégradé CSS répété).
- **« la vision inflation doit être cochable »** : case `#inflation-on`, active par défaut.
  Elle commande **d'un bloc** le champ d'inflation, le bloc sous le bilan, la paire en
  pointillés et **les deux colonnes constantes des exports** — d'où le paramètre
  `{ constantEuros }` de `buildWorkbook`, `buildCsv`, `exportXlsx`, `exportCsv` et
  `renderBalanceChart`, et la fonction `scheduleHeaders()` qui remplace l'usage direct de
  `SCHEDULE_HEADERS` dans le CSV. `SCHEDULE_HEADERS` reste exporté, liste complète.

### 8.5 Ce que ce tour laisse ouvert

- **Le point §6.4 reste entier** : l'onglet `Hypothèses` a gagné la mise en page, pas les
  deux colonnes « souhaité / contractualisé ». Il annonce toujours le capital comme
  « saisi » alors qu'une marge active peut l'avoir déplacé.
- **Le pas du taux (0,05 point) est un choix, pas une donnée.** Thomas a dit « pareil pour
  le taux » sans chiffrer. 0,05 est ce qui se pratique en négociation ; à confirmer.
- Le **pas de la durée** n'a pas été touché : elle se saisit toujours librement en années
  ou en mois.

---

## 9. Pour démarrer

Lire dans l'ordre : ce fichier, puis `README.md` (ce que fait l'outil et pourquoi), puis
`docs/SPEC-echeancier-pret.md` §4 (conventions de calcul) et §6 (les dix invariants).
Lancer `npx vitest run` pour vérifier que le socle est sain avant de toucher à quoi que ce
soit.
