# Échéancier de prêt — brief de reprise de session

> Document d'amorçage pour une nouvelle session Claude Code. Autoportant : il ne suppose
> aucun accès aux conversations précédentes. Écrit le 16 août 2026, mis à jour le même
> jour après le **troisième** tour de retours d'interface (§8), après l'ajout de
> l'**export de la reconnaissance de dette** (§9), puis après le **quatrième** tour de
> retours (§10) — celui qui a fait tomber le bug du prêt sans intérêt.

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
| Branche de travail | `main` |
| Pages sert | `main`, à la racine (vérifié : `gh api repos/:owner/loan-schedule/pages`) |
| Tests | 244, tous verts (`npx vitest run`) |
| Version | `0.2.0`, dans `src/core/version.js` — incrémentée à chaque tour déployé |
| Dernier commit | celui qui porte l'export PDF (§9) et le quatrième tour (§10) |

Le chemin local contient des accents et des espaces : **le quoter systématiquement** en bash.

---

## 2. Architecture

Modules ES natifs, **aucun bundler, aucune étape de build**. Ce qui est dans le dépôt est
ce qui est servi, ce qui supprime le piège des chemins absolus sur GitHub Pages.

```
index.html          page unique (markup + CSS + polices vendorisées)
src/core/           calcul pur, sans DOM — finance.js, format.js, words.js, version.js
src/export/         csv.js, xlsx.js
src/export/pdf/     metrics.js, document.js (écrivain PDF), deed.js (l'acte)
src/ui/             app.js (câblage), chart.js (2 graphiques), table.js
vendor/             write-excel-file 4.1.1 + IBM Plex, avec leurs licences
tests/              finance, export, pdf, words, format, page
docs/               SPEC-echeancier-pret.md (la référence), ce fichier
```

`src/core/version.js` est la **source unique** du numéro de version : le pied de page de la
page, le pied de chaque page du PDF et l'onglet `Hypothèses` du classeur y puisent, et
`tests/page.test.js` tient `package.json` en phase. À incrémenter à chaque tour déployé.

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

**Prêt sans intérêt.** Un coût nul, ou un taux de 0 %, donne un prêt gratuit — invariant
absolu depuis le quatrième tour (INV-014, §10.1). Le taux ne bouge pas ; ce qui peut bouger,
dans la marge autorisée, c'est la somme prêtée, jusqu'à ce que la durée la divise.

**Inflation et fiscalité**, dans une section « Effet de l'inflation » sous le bilan, commandée
par la case « vision inflation » — qui commande aussi les pointillés du graphique et les
colonnes correspondantes des exports. Lecture en euros constants du départ, plus une ligne
indicative nette de PFU ; les montants nominaux restent l'affichage principal.

**Deux graphiques**, tous deux en escalier : composition de chaque échéance (bâtons
jointifs, intérêts/capital) et extinction de la dette (avec les versions déflatées en
pointillés, nommées en légende).

**Exports** CSV et XLSX (valeurs, pas de formules — hors périmètre), volets figés, mise en
page du classeur calculée à partir des données (§8.1). Et le **PDF de la reconnaissance de
dette**, échéancier annexé, écrit sans bibliothèque (§9).

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

**`write-excel-file` ignore en silence une propriété de cellule qu'il ne connaît pas.** La
couleur de police s'appelle **`textColor`**, pas `color` : l'en-tête était écrit en noir sur
fond presque noir, sans une erreur ni un avertissement, et la charge utile paraissait juste
(§10.2). Corollaire de méthode : sur ce module, une assertion sur la charge utile ne prouve
rien qu'un renommage d'API ne puisse démentir — descendre jusqu'au XML produit.

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

1. ~~**Fusionner `feat/loan-schedule` dans `main`**, puis basculer Pages.~~ **Fait** :
   Pages sert `main` à la racine, la branche de travail est `main`.
2. ~~**Certificat de dette généré par l'application.**~~ **Fait le 16 août 2026** — voir
   §9 : export PDF d'une reconnaissance de dette, échéancier annexé, sur la structure de
   la fiche de l'INC. Ce qui reste ouvert de ce point est listé en §9.4.
3. **Saisir directement la mensualité voulue.** Devenu plus criant depuis que la mensualité
   ronde est la seule convention : le coût saisi ne sert plus qu'à viser une mensualité,
   qui détermine ensuite le coût réel. Un troisième bouton « je choisis la mensualité »
   serait plus honnête — « je veux payer 1 000 € par mois pendant 20 ans, ça fait quel
   taux ? ».
4. **L'onglet « Hypothèses » du tableur n'a pas suivi le bilan.** Il annonce le capital
   comme « saisi » alors qu'une marge active peut l'avoir déplacé (`solved.principal` vs
   `solved.requestedPrincipal`), et il ne porte pas les deux colonnes. À reprendre avec le
   point 2, dont il est la matière première.
5. ~~**Numéro de version en pied de page**~~ **Fait le 16 août 2026** — voir §10.5 :
   `src/core/version.js`, porté par la page, le PDF et le classeur.
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

- ~~**Une phrase pleine largeur ne doit pas fixer la largeur de sa colonne.** L'avertissement
  « ce n'est pas un TAEG » vit en colonne A de l'onglet `Hypothèses` et est censé déborder
  sur les cellules vides à sa droite. D'où le paramètre `measured` de `sheet()`, qui exclut
  ces lignes du calcul de largeur.~~ **Caduc depuis le quatrième tour** : l'avertissement a
  été retiré (§10.4), et `measured` avec lui, plus rien ne l'utilisant. À ressortir de
  l'historique git le jour où une phrase pleine largeur reviendra dans un onglet.
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

## 9. Reconnaissance de dette en PDF, 16 août 2026

Le point §6.2 est traité. Demande : « ajoute l'export d'un modèle de reconnaissance de
dette avec l'échéancier annexé, sur cette base
<https://www.inc-conso.fr/content/pret-dargent-un-proche-comment-etablir-une-reconnaissance-de-dettes>,
au format PDF, avec les champs laissés libres pour que l'utilisateur ait largement la place
de remplir ses infos personnelles de façon manuscrite ».

Le cadrage complet est en `docs/SPEC-echeancier-pret.md` §5 bis, invariants compris
(INV-011 à INV-013). Ce qui suit est ce qu'il faut savoir avant d'y toucher.

### 9.1 Ce qui a été ajouté

```
src/core/words.js          montants en toutes lettres (français, pièges compris)
src/export/pdf/metrics.js  largeurs Adobe des 3 Helvetica, WinAnsi, repli des lignes
src/export/pdf/document.js pages, texte, filets, rectangles, xref — l'écrivain PDF
src/export/pdf/deed.js     la mise en page de l'acte et de l'annexe
tests/words.test.js        11 tests
tests/pdf.test.js          27 tests
```

Plus, côté existant : un bouton `#export-pdf` dans la barre de l'échéancier, deux lignes
de pied de page, `formatDate` et `formatLongMonth` dans `src/core/format.js`.
**208 tests verts** (170 avant). `src/core/finance.js` n'a pas bougé : rien de tout cela ne
touche au calcul.

### 9.2 Pourquoi un écrivain PDF maison

La page affirme qu'aucun octet ne vient d'un tiers. Vendoriser une bibliothèque PDF, c'est
quelques centaines de kilo-octets à auditer et à licencier pour un document fait de texte,
de filets et de rectangles. Les flux de contenu ne sont pas compressés : le PDF produit se
lit dans un éditeur de texte, comme le reste de l'outil se vérifie à la main.

Deux conventions de l'écrivain : coordonnées **depuis le coin supérieur gauche** (le
retournement se fait une fois, dans `document.js`), et **chaque tracé est enregistré** dans
`doc.trace` — c'est ce qui rend la mise en page testable sans relire le fichier.

### 9.3 Pièges rencontrés, mesurés, à ne pas redécouvrir

- **Le signe € est dessiné trop large par le moteur PDF d'Apple** (QuickLook, Aperçu),
  quelles que soient les largeurs déclarées dans le fichier : le glyphe recouvre ce qui le
  suit sur la même ligne, « 1 520 €, » perd sa virgule. Vérifié aussi en positionnant
  chaque fragment séparément : c'est bien le glyphe, pas l'avance. D'où la règle de
  rédaction — le symbole seulement en fin de suite (tableaux, montant encadré), « euros »
  en toutes lettres dans les phrases (`eurosInWords` dans `deed.js`).
- **Une chaîne du dictionnaire `/Info` n'est pas du WinAnsi** mais du PDFDocEncoding : le
  titre s'affichait « Reconnaissance de dette Š 10€000€ » dans l'onglet du navigateur. Elles
  sont écrites en UTF-16BE avec BOM (`textString`).
- **Les visionneuses ne replient rien** : la coupure des lignes est calculée ici, d'où les
  tables de largeurs. Le fichier déclare les mêmes largeurs (`/Widths`) pour qu'aucune
  substitution de police ne mesure autrement.
- **Le bloc « à savoir » est posé d'un seul tenant** (`flow.needs` de sa hauteur totale) :
  coupé, sa dernière puce se retrouvait seule sur une septième page.
- **L'index de page d'un tracé n'est pas `pages.length - 1`** : `eachPage` (les numéros de
  page, écrits quand le total est connu) dessine sur des pages qui ne sont plus la
  dernière. Chaque page porte son index.

Rendu vérifié page à page : `qlmanage -t -s 1400 -o . page-N.pdf` sur des PDF découpés
page par page, QuickLook ne rendant que la première. Export rejoué dans le navigateur
(blob `application/pdf`, 98 ko, `%PDF-1.4` / `%%EOF`), console vide, journal réseau sans
aucune requête tierce.

### 9.4 Ce que ce tour laisse ouvert

- **Le point §6.4 reste entier** : l'onglet `Hypothèses` du classeur ne distingue toujours
  pas montant souhaité et montant retenu, alors que l'acte, lui, ne porte que le retenu.
- **Aucune donnée personnelle n'est saisie à l'écran**, par choix : l'acte se remplit à la
  main. Si des champs de saisie devaient apparaître, il faudrait dire ce qu'ils deviennent
  (rien ne sort du navigateur, mais encore faut-il l'écrire).
- **Le mode de versement est un jeu de cases à cocher** imprimées, à noircir au stylo :
  aucune n'est pré-cochée puisque l'outil ne sait pas comment les fonds circulent.
- **Le libellé de colonne « Contractualisé » du bilan** (§7.4) engage moins qu'avant, mais
  la question de la valeur juridique du modèle reste posée : le document le dit lui-même,
  il ne vaut pas conseil juridique.

---

## 10. Quatrième tour de retours, 16 août 2026

Source : un PDF de captures annotées (`feedbacks appli calcul prêt (1).pdf`), sept
remarques. Toutes traitées ; **244 tests verts** (208 avant), rendu vérifié en 1280 px et en
375 px, console vide, journal réseau sans aucune requête tierce, exports rejoués dans le
navigateur (PDF 98 ko, classeur 15 ko). Ce tour est le premier depuis longtemps qui
**touche à `src/core/finance.js`** : il contenait un vrai bug.

### 10.1 Le solveur fabriquait des intérêts sur un prêt gratuit

« on doit pouvoir spécifier un coût d'emprunt nul ou un taux d'intérêt à 0 %. C'est un
invariant (toujours vrai). ici le solveur force des intérêts. » — 10 000 € sur 120 mois,
coût 0 € : l'écran affichait 84 € par mois, 0,1583 % et 80 € d'intérêts.

**Ce n'était pas `solveRate`**, qui rend bien `0` sur un coût nul, mais la recherche en
euros ronds : `solveRoundPayment` glisse la mensualité jusqu'au premier entier qu'un taux
solde exactement. Ce glissement suppose un taux disponible pour compenser. Sur un prêt
gratuit il n'y en a pas, et `10 000 / 120 = 83,33 €` n'est pas entier : la recherche
fabriquait donc les intérêts nécessaires pour atteindre 84 €.

Ce qui est en place (INV-014, cadré au SPEC §6) :

- `interestFree` est calculé en tête de `solveLoan` et **court-circuite les deux recherches
  qui déplacent le taux**. Absolu, marges comprises : « sans intérêt » est une catégorie —
  ce que deux proches se sont dit, ce que l'acte imprimera — pas un taux petit.
- Le seul degré de liberté restant est la somme prêtée
  (`solveInterestFreeRoundPayment`) : dans la marge autorisée, on cherche un capital que la
  durée divise. 10 200 € sur 120 mois font 85 € tout rond, et gratuits.
- À défaut, repli du §4.3 — la mensualité garde ses centimes, la dernière échéance les
  absorbe — et **la note dit la vraie raison**. L'ancienne (« aucune mensualité ronde, même
  en s'écartant de 24 € ») accusait une recherche qui n'a jamais tourné. Elle nomme
  maintenant le montant qui tomberait juste (`nearestInterestFreePrincipal`).
- L'étiquette de mode et la légende du bilan passent à « sans intérêt ».

### 10.2 Le classeur : un nom de propriété, pas une couleur

« il faut un meilleur contraste sur les header, là je vois rien ». L'en-tête était écrit en
**noir sur le fond presque noir** de la charte. La cellule déclarait `color: "#FFFFFF"` ;
`write-excel-file` lit **`textColor`**, et ignore en silence toute propriété inconnue. Rien
n'a levé d'erreur — et la charge utile était parfaitement lisible, c'est le fichier produit
qui ne l'était pas. Même correction sur le gris des colonnes de notes.

**À ne pas redécouvrir :** aucune assertion sur la charge utile n'aurait attrapé ça. Le test
ajouté ouvre l'archive `.xlsx` (zip : en-tête local, puis `inflateRawSync`), décompresse
`xl/styles.xml` et y cherche `<color rgb="FFFFFFFF"/>`. C'est le seul niveau où la question
« que verra le lecteur » a une réponse.

Le paramètre `measured` de `sheet()` a disparu avec la phrase pleine largeur qu'il servait
(§10.4) : plus rien ne l'utilisait.

### 10.3 Le taux s'affiche par pas de 0,05 point

« affiche par pas de 0.05 % max (et entre parenthèse la valeur retenue pour le calcul).
A la fin c'est l'échéancier qui a la valeur contractuelle. »

Le taux rendu par la recherche n'est pas négocié, il est **subi** : c'est celui qui fait
tomber les échéances juste. `2,9116 %` invitait à une comparaison à une précision qui ne
veut rien dire. Le bilan lit donc le taux sur le pas auquel il se saisit
(`formatSteppedPercent`, `RATE_STEP` dans `format.js`), avec `(2,8785 % retenus)` en
sous-ligne — et l'écart affiché se calcule sur les valeurs lues, donc lui aussi sur la
grille. **L'acte exporté garde la valeur exacte** : un contrat n'arrondit pas.

### 10.4 Trois remarques de rédaction

- **« taux réel »** devient **« taux réel, net d'inflation »** : seul, il se lisait comme
  « le vrai taux », le contresens exact.
- **Le bloc des euros constants devient une section « Effet de l'inflation »**, avec la
  **fiscalité** demandée « avec la source » : PFU de 30 % (12,8 % IR + 17,2 % prélèvements
  sociaux), service-public.fr fiche F2613, en vigueur en 2026. Les taux sont des constantes
  du noyau (`FLAT_TAX_*`), la ligne est libellée indicative et rendue en gris, et
  `tests/page.test.js` vérifie que la phrase de la page cite bien ces constantes — la prose
  n'est recompilée par rien.
- **« hors assurance et frais annexes » est retiré partout** (écran, classeur, acte) :
  « elle inspire méfiance ». L'outil ne calcule ni assurance ni frais et n'offre aucun champ
  pour en saisir ; une phrase qui prémunit contre une lecture que rien ne suggère se lit
  comme un aveu. Un test interdit son retour dans les trois fichiers.

### 10.5 La version

« En pied de page, le pdf doit comporter la version de l'appli (comme ça si bug, on pourra
savoir de quelle version ça vient). » — `src/core/version.js`, source unique, portée par le
pied de chaque page du PDF (`v0.2.0 · page 2 / 6`), l'onglet `Hypothèses` du classeur et le
pied de la page. Traite du même coup le point §6.5, qui la réclamait à cause du cache de dix
minutes de Pages.

### 10.6 Ce que ce tour laisse ouvert

- **Le point §6.4 reste entier** : l'onglet `Hypothèses` ne distingue toujours pas montant
  souhaité et montant retenu.
- **La section « Effet de l'inflation » disparaît avec la case « vision inflation »**, donc
  la ligne de fiscalité aussi, alors qu'elle ne dépend pas de l'inflation. Assumé pour
  l'instant : c'est une seule et même lecture secondaire. À revoir si Thomas décoche.
- **Le taux réel net d'impôt** vaut `realRate(nominal × 0,7, π)` : approximation assumée
  (seuls les intérêts sont imposés), et le taux du PFU est figé dans le code — il changera.

---

## 11. Pour démarrer

Lire dans l'ordre : ce fichier, puis `README.md` (ce que fait l'outil et pourquoi), puis
`docs/SPEC-echeancier-pret.md` §4 (conventions de calcul) et §6 (les invariants du calcul),
enfin §5 bis si le travail touche au PDF.
Lancer `npx vitest run` pour vérifier que le socle est sain avant de toucher à quoi que ce
soit.
