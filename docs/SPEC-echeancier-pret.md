# Échéancier de prêt amortissable — spécification et brief de session

> Document d'amorçage pour une session Claude Code. Il est autoportant : il ne suppose
> aucun accès à la conversation qui l'a produit. Un prototype fonctionnel existe déjà
> (voir §7) ; il sert de référence de calcul, pas de contrainte d'implémentation.

---
## 1. Mission

Construire une application web statique, hébergée sur **GitHub Pages**, qui transforme
trois hypothèses saisies par l'utilisateur en un **échéancier de remboursement complet et
auditable**, exportable en tableur.

Le fil directeur du produit est la **transparence du calcul** : aucun chiffre affiché ne
doit être une boîte noire. L'utilisateur doit pouvoir refaire le calcul à la main, ou dans
son propre tableur, à partir de ce que l'écran lui montre.

### Ordre de travail imposé

1. **Phase 0 — recherche de l'existant open source** (§2). À faire *avant* d'écrire du
   code, et à restituer avant toute décision d'architecture.
2. Phase 1 — décision « réutiliser / adapter / réécrire », argumentée, validée par moi.
3. Phase 2 — implémentation, en suivant la méthodologie `methodical-dev`
   (découpage en étapes atomiques, checkpoint et validation après chaque étape).

---

## 2. Phase 0 : recherche de l'existant

**Avant toute recherche web, activer le skill `web-search-primary-sources`** et appliquer
le protocole des trois listes (A : ce qui est déjà connu / B : résultats de recherche naïve
/ C : consolidation), puis attendre mon GO avant de synthétiser.

### Ce qu'il faut chercher

| Brique | Question à instruire |
|---|---|
| Calcul d'amortissement | Bibliothèques JS d'amortissement et de fonctions financières (équivalents de `PMT`, `RATE`, `IPMT`, `PPMT`). Pistes connues : `formulajs`, `financejs`, `tvm`, paquets npm `amortization`. Licence, maintenance, taille, absence de dépendances lourdes. |
| Résolution inverse | Existe-t-il une implémentation open source éprouvée de `RATE` (Newton-Raphson ou dichotomie) qu'on puisse reprendre plutôt que réécrire ? Regarder notamment l'implémentation de LibreOffice / Apache OpenOffice et celle de Formula.js. |
| Export tableur | `SheetJS` (`xlsx`, Apache-2.0) fait référence. Vérifier s'il permet bien l'écriture de **formules** (et pas seulement de valeurs) dans la version communautaire, et regarder les alternatives (`exceljs`, `write-excel-file`) sur ce critère précis. |
| Applications complètes | Calculateurs d'amortissement open source déjà déployés en statique, à titre d'inspiration UI et de vérification croisée des chiffres. |

### Critères d'évaluation à appliquer

1. **Licence** compatible avec une publication sur GitHub Pages (MIT / Apache-2.0 / BSD).
2. **Poids et dépendances** : la page doit rester une page statique légère.
3. **Capacité à résoudre le problème inverse** (§4.2), qui est le cœur du besoin et que la
   plupart des calculateurs ne traitent pas.
4. **Vérifiabilité** : préférer une brique dont on peut lire et expliquer le calcul plutôt
   qu'une boîte noire compacte.

### Livrable de la phase 0

Un tableau comparatif court (brique / candidat / licence / verdict), puis une
recommandation explicite : ce qu'on réutilise tel quel, ce qu'on adapte, ce qu'on écrit
nous-mêmes et pourquoi. **Stop, validation, avant d'écrire du code.**

---

## 3. Spécification fonctionnelle

### 3.1 Entrées

| Champ | Type | Défaut | Contraintes |
|---|---|---|---|
| Somme empruntée | montant € | 200 000 | > 0 |
| Durée d'emprunt | entier + unité (années / mois) | 20 ans | ≥ 1 mensualité, ≤ 1200 |
| Coût cumulé de l'emprunt | montant € | 52 000 | ≥ 0 |
| Date de première échéance | date | mois suivant | facultative, sert à l'étiquetage |

Saisie tolérante au format français : séparateur de milliers par espace, virgule
décimale (`200 000` et `1 234,56` doivent être acceptés).

### 3.2 Mode réciproque

Un basculement permet de saisir le **taux annuel nominal** à la place du coût cumulé, et
d'en déduire le coût. Même moteur, même échéancier, sens de résolution inversé.

### 3.3 Sorties

**Bloc de résolution** (affiché en permanence, mis à jour à chaque frappe) :

- mensualité constante,
- taux mensuel résolu et taux annuel nominal (proportionnel),
- coût total effectif et écart avec l'hypothèse saisie,
- le nombre d'itérations et l'écart résiduel du solveur.

> **Révisé le 16 août 2026.** Le bloc affichait aussi l'équation `M = P · i / (1 − (1+i)^−n)`
> avec ses valeurs substituées. Elle a été retirée : elle ne dit rien à qui n'a pas déjà la
> formule en tête, et surtout elle décrit mal le mode du §4.3 bis, où le taux ne produit pas
> la mensualité mais s'y ajuste. La transparence passe désormais par les invariants affichés
> (itérations, résidu, solde final) et par les conventions écrites en pied de page.
>
> **Arrondi d'affichage, même date.** Les montants **cumulés** — coût total, coût et total
> versé en euros constants — s'affichent à l'euro : au centime, ils imposaient au lecteur un
> écart de quatre centimes sans portée. Les **mensualités** gardent leurs centimes, c'est le
> montant réellement viré. L'écart avec l'hypothèse saisie n'est plus énoncé sous 0,50 €,
> seuil en dessous duquel il ne change pas le nombre affiché ; au-delà il l'est toujours.
> Calcul, échéancier et exports restent au centime : c'est un choix d'affichage, rien d'autre.
>
> **Taux équivalent retiré, même date.** Le bloc affichait aussi le taux annuel équivalent
> (actuariel), et le pied de page en donnait la formule. Les deux sont partis, avec la ligne
> correspondante de l'onglet des hypothèses du tableur. Motif : sur un prêt amortissable
> l'emprunteur règle ses intérêts à chaque échéance, rien ne se capitalise côté dette, et ce
> taux n'apparaît dans aucun de ses flux — c'est le TRI du prêteur, sous hypothèse de
> réinvestissement des mensualités. L'afficher à côté du nominal laissait croire à un coût
> qu'il ne supporte pas. La fonction `annualEquivalentRate` reste dans le noyau, testée : le
> retrait porte sur l'affichage, pas sur le calcul.

**Échéancier**, une ligne par mensualité, colonnes :

`N° | Échéance (date) | Mensualité | Intérêts | Capital amorti | Capital restant dû | Intérêts cumulés | Capital remboursé cumulé`

Regroupement par année civile avec ligne de sous-total, et deux vues : détail mensuel /
synthèse annuelle seule.

**Graphiques**, deux, tous deux en escalier — jamais de courbe lissée, parce qu'une
courbe lisse suggère une variation continue alors que rien ne bouge entre deux échéances :

1. **Composition de chaque échéance** : un bâton par mensualité, empilé, intérêts en bas
   et capital amorti au-dessus, bâtons jointifs. L'échelle verticale est la mensualité
   elle-même, donc le sommet est plat dès que la mensualité est constante.
2. **Extinction de la dette** : capital restant dû qui descend, intérêts cumulés qui
   montent, chacun en marches d'escalier — le niveau tient tout le mois et saute à la
   date d'échéance.

Les deux se lisent au survol et au clavier (flèches, Home, Fin ; Maj pour sauter d'un an).

> **Révisé le 15 août 2026.** La version initiale demandait deux courbes lissées sur un
> seul graphique. Le découpage en deux répond à deux questions distinctes — « où part mon
> argent ce mois-ci ? » et « où en suis-je ? » — que le graphique unique mélangeait sur
> une échelle commune où les intérêts cumulés écrasaient tout. Le premier rend en outre
> visible la propriété du mode §4.3 bis : mensualités toutes égales, sommet parfaitement
> plat.

**Exports** :

- CSV point-virgule, BOM UTF-8, décimales à la virgule (compatible Excel FR) ;
- **XLSX à formules vivantes** (§5), c'est le livrable principal.

---

## 4. Spécification de calcul

### 4.1 Modèle

Prêt amortissable classique, à mensualités constantes, intérêts calculés sur le capital
restant dû.

```
M = P · i / (1 − (1 + i)^(−n))
```

avec `P` capital emprunté, `i` taux **mensuel**, `n` nombre de mensualités, `M` mensualité.
Cas dégénéré : si `i = 0`, alors `M = P / n`.

### 4.2 Problème inverse (cœur du besoin)

L'utilisateur ne fournit pas le taux : il fournit `P`, `n` et le coût cumulé `C`. La
mensualité cible est donc connue exactement :

```
M_cible = (P + C) / n
```

et il faut résoudre en `i` :

```
f(i) = P · i / (1 − (1 + i)^(−n)) − M_cible = 0
```

`f` est **strictement croissante en `i`**, ce qui autorise une méthode par encadrement puis
dichotomie, inconditionnellement convergente et facile à exposer à l'écran :

1. si `C ≤ 0` → `i = 0`, sortie immédiate ;
2. encadrement : partir de `hi = 0,01`, doubler tant que `payment(hi) < M_cible` (garde-fou `hi < 10`) ;
3. dichotomie, arrêt sur `|f(mid)| < 1e-12` ou `hi − lo < 1e-16`, plafond 200 itérations ;
4. exposer `i`, le nombre d'itérations et le résidu `f(i)`.

Newton-Raphson est acceptable si la phase 0 fait remonter une implémentation open source
éprouvée, **à condition** de conserver un repli par dichotomie et de continuer à afficher
la convergence.

### 4.3 Conventions d'arrondi (à respecter à la lettre)

Ce sont elles qui font qu'un échéancier tombe juste ou pas.

1. La mensualité est arrondie au centime : `M_arrondie = round2(M)`.
2. À chaque échéance, `intérêts = round2(capital_restant_dû × i)`, puis
   `capital_amorti = round2(M_arrondie − intérêts)`.
3. **La dernière échéance absorbe la dérive** : `capital_amorti = capital_restant_dû`, et
   `mensualité = capital_amorti + intérêts`. Elle est signalée comme ajustée dans le tableau.
4. Conséquence assumée : le coût total effectif diffère de l'hypothèse saisie de quelques
   centimes. **Cet écart doit être affiché, pas masqué.**

### 4.3 bis — Mode « mensualité en euros ronds » (ajouté le 15 août 2026)

Convention alternative, **active par défaut**, destinée au prêt entre particuliers remboursé
par virement permanent : une dernière échéance ajustée y oblige l'emprunteur à corriger son
virement, ce qui n'est pas un problème pour une banque (elle prélève) mais en est un ici.

Dans ce mode, la mensualité est un **nombre entier d'euros** et vaut la même chose sur les
`n` échéances, sans exception. Il n'y a plus d'échéance ajustée.

Cela n'est possible que parce qu'on dispose d'un degré de liberté : **le taux est continu,
alors que le solde final ne prend que des valeurs en centimes**. Pour une mensualité entière
donnée, les taux qui soldent exactement le prêt forment donc un intervalle — quand cet
intervalle n'est pas vide, car un pas peut enjamber zéro. L'algorithme :

1. calculer la mensualité idéale `(P + C) / n`, l'arrondir à l'euro ;
2. pour cette mensualité, chercher par dichotomie un taux qui solde à `0,00 €` exactement ;
3. si aucun n'existe, essayer la mensualité entière suivante, en s'écartant d'un euro à la
   fois, de part et d'autre (à égalité, la mensualité la plus basse gagne) ;
4. en pratique un écart de 0 à 3 € suffit toujours sur les cas testés ; la recherche
   abandonne au-delà de 24 € et le mode se désactive alors proprement.

**Le coût total n'est plus celui saisi** : il vaut exactement `n × M − P`. Le déplacement
de la mensualité, le taux retenu et le nouveau coût doivent être affichés en toutes lettres.
C'est le prix de la contrainte, et il n'a pas à être discret.

### 4.4 Conventions de taux

- Taux annuel **nominal** = `i × 12` (taux proportionnel, convention des offres de prêt françaises).
- Taux annuel **équivalent** (actuariel) = `(1 + i)^12 − 1`. Les deux sont affichés, jamais confondus.
- Le périmètre est **hors assurance emprunteur, frais de dossier, garantie et frais annexes** :
  ce n'est pas un TAEG, et l'interface doit le dire.

### 4.6 — Pouvoir d'achat (ajouté le 16 août 2026)

Jusqu'ici l'inflation était implicitement nulle. Elle devient un paramètre, **2 % par
défaut**, et permet de lire les montants en **euros constants de la date de départ**.

- déflateur de l'échéance de rang `k` : `(1 + π)^(k/12)`, convention **équivalente**
  (actuarielle). Jamais `π/12` : l'inflation se compose, comme le §4.4 le rappelle déjà
  pour le taux d'intérêt.
- L'échéance de rang `k` tombe `k` mois après le départ du prêt : la première porte déjà
  un mois d'intérêts, donc rang et mois écoulés coïncident.
- **Chaque versement est déflaté à sa propre date, puis sommé.** Déflater le cumul final
  reviendrait à traiter vingt ans de versements comme s'ils avaient tous eu lieu le
  dernier jour, et surestime massivement l'érosion. C'est l'erreur à ne pas commettre.
- taux réel : `(1 + taux nominal) / (1 + π) − 1`, formule de Fisher. `taux − π` n'en est
  que l'approximation au premier ordre.

Les montants **nominaux restent l'affichage principal** : c'est ce qui quitte le compte
chaque mois, et c'est le chiffre dont on a besoin pour paramétrer un virement. Les euros
constants sont une lecture supplémentaire, jamais un remplacement.

### 4.7 — Marges de négociation (ajouté le 16 août 2026)

Un prêt entre particuliers ne se négocie pas sur des nombres libres. Deux contraintes :

1. **La somme prêtée se négocie par tranches de 100 €.** On prête 5 100 €, pas
   5 137,42 €. C'est une propriété du problème, donc une constante du code
   (`PRINCIPAL_STEP`), pas un réglage. Ce que le prêteur règle, c'est **de combien il
   accepte de s'écarter** du montant visé. Une marge nulle signifie « ce montant-là,
   exactement », et la granularité ne prend alors pas le pas sur la volonté saisie.
2. **Le taux, ou le coût, se négocie avec une marge** exprimée dans l'unité du champ
   actif : ±€ sur le coût, ±% sur le taux.

Le mode « mensualité en euros ronds » passe alors de **un** degré de liberté à **trois**
— capital, mensualité, taux — ce qui le rend bien plus souvent soluble. L'algorithme :

1. capitaux candidats : multiples de 100 € dans la marge, triés par écart croissant ;
2. la mensualité croissant avec le taux, la bande de taux tolérée borne directement
   l'intervalle des mensualités entières à essayer — quelques dizaines, pas une force brute ;
3. pour chacune, `rateForExactInstalment` donne le taux qui solde exactement, ou rien ;
4. on retient les combinaisons dans les marges, classées par écart au capital voulu
   d'abord, à l'objectif ensuite : déplacer le capital est une négociation avec l'autre
   partie, déplacer le taux ne l'est pas.

**En cas d'échec, l'interface donne les deux indices d'élargissement**, calculés
séparément : de combien il faudrait céder sur le taux (ou le coût) à marge de capital
constante, et de combien il faudrait céder sur le capital à marge de taux constante, en
nommant le montant qui conviendrait. Elle dit aussi ce qui est affiché à la place.

### 4.5 Hors périmètre (v1)

Assurance emprunteur, remboursements anticipés, différé d'amortissement, taux variable,
prêts in fine, multi-lignes de prêt, palier de mensualité. À garder à l'esprit dans la
structure du code, à ne pas implémenter.

---

## 5. Export XLSX

> **Révisé le 15 août 2026.** Les formules vivantes ont été **sorties du périmètre** sur
> décision explicite. La version initiale de ce paragraphe, qui décrivait un classeur se
> recalculant tout seul et le détail des formules colonne par colonne, est caduque et a
> été retirée. Elle reste consultable dans l'historique git.

Le classeur exporté porte **les valeurs calculées**, avec les formats de nombre qui vont
avec, sur deux onglets.

**Onglet `Hypothèses`** : capital emprunté, nombre de mensualités, taux mensuel,
mensualité, taux annuel nominal, taux annuel équivalent, coût total des intérêts, coût
saisi, **écart d'arrondi**, date de première échéance. Chaque ligne porte une note qui dit
d'où vient la valeur — « saisi », « résolu par dichotomie, N itérations », « taux mensuel
× 12 ». C'est ce qui remplace la transparence qu'apportaient les formules : le lecteur
peut refaire le calcul, même si le classeur ne le refait plus pour lui.

**Onglet `Échéancier`** : en-têtes ligne 1, une ligne par échéance ensuite, colonnes
identiques à celles du §3.3. Les montants sont écrits comme des **nombres** au format
`#,##0.00`, les dates comme des **dates** au format `dd/mm/yyyy` — jamais comme du texte
pré-formaté, pour rester exploitables dans un tableur.

Si les formules devaient revenir au périmètre, la bibliothèque retenue
(`write-excel-file`) sait les écrire via un type de cellule `Formula` : ce serait une
évolution du module `src/export/xlsx.js`, pas un changement de brique.

---

## 6. Invariants et jeux de test

À couvrir par des tests automatisés (`vitest` ou équivalent), le moteur de calcul devant
être isolé de l'interface pour être testable sans DOM. Valeurs vérifiées sur le prototype.

**INV-001 — Le capital est intégralement remboursé.** Après la dernière échéance, le
capital restant dû vaut exactement `0,00 €`, quels que soient `P`, `n`, `C`.

**INV-002 — Conservation.** `Σ capital_amorti = P` et `Σ mensualités = P + Σ intérêts`, au
centime près, sur tout jeu d'entrées valide.

**INV-003 — Nombre de lignes.** L'échéancier compte exactement `n` lignes.

**INV-004 — Fidélité à l'hypothèse de coût.** `|Σ intérêts − C| ≤ 0,05 €` (l'écart provient
uniquement des arrondis au centime).

> **Corrigé le 15 août 2026, à la suite d'un test rouge.** La borne de cinq centimes tient
> sur le cas de référence A dont elle est tirée, mais ce n'est pas un théorème : arrondir
> les intérêts au centime à chaque échéance dérive jusqu'à un demi-centime par période, et
> la dernière mensualité absorbe la dérive en *capital*, pas celle en *intérêts*. Le cas
> `P = 12 345,67 €, n = 37, C = 987,65 €` atteint six centimes. La borne effectivement
> garantie par les conventions du §4.3 est `0,005 × n + 0,01` ; c'est elle qui est testée
> dans le cas général, la borne de cinq centimes restant asserée sur le cas A.

**INV-005 — Aller-retour des modes.** Résoudre le taux depuis un coût, puis réinjecter ce
taux en mode « je connais le taux », redonne le même échéancier au centime près.

**INV-006 — Monotonie.** La part d'intérêts décroît strictement et la part de capital croît
strictement d'une échéance à la suivante (hors dernière échéance ajustée), pour `i > 0`.

**INV-007 — Cas dégénéré `n = 1`.** La solution analytique est `i = C / P` : le solveur doit
la retrouver à `1e-9` près.

**INV-008 — Mensualité ronde invariante** (ajouté le 15 août 2026, mode du §4.3 bis). La
mensualité est un entier d'euros ; les `n` échéances portent **toutes** ce même montant,
aucune n'est marquée ajustée ; le capital restant dû après la dernière vaut exactement
`0,00 €` ; et le coût total vaut exactement `n × M − P`. L'écart entre la mensualité idéale
et la mensualité retenue reste `≤ 3 €` sur les cas de référence.

**INV-009 — Euros constants** (§4.6). À `π = 0`, les montants en euros constants égalent
exactement les nominaux. Pour `π > 0`, chaque montant déflaté est inférieur à son nominal
et le rapport décroît strictement avec le rang de l'échéance ; pour `π < 0`, l'inégalité
s'inverse. Le coût en euros constants est la somme des intérêts déflatés **à leur propre
date**, strictement supérieure au cumul final déflaté en bloc. Le taux réel vaut
`(1+i)/(1+π) − 1`.

**INV-010 — Marges respectées** (§4.7). Toute solution rendue par la recherche sous
contraintes prête un multiple de 100 €, verse une mensualité entière identique sur les `n`
échéances, solde à `0,00 €` exactement, et respecte les deux marges. Quand aucune solution
n'existe, **suivre l'indice proposé doit en produire une** : c'est le seul test qui
prouve qu'un indice est juste, et non simplement affiché.

**Cas de référence A** — `P = 200 000 €`, `n = 240`, `C = 52 000 €` :

```
taux mensuel        0,0019992303  (0,199923 %)
taux annuel nominal 2,399 %
taux équivalent     2,426 %
mensualité          1 050,00 €
dernière échéance   1 049,96 €  (ajustée)
intérêts cumulés    51 999,96 €
convergence         48 itérations, résidu ~1,3e-11 €
```

> **48 et non 47.** Le prototype renvoyait le milieu du *dernier encadrement* au lieu du
> point dont il venait de mesurer le résidu. L'erreur était invisible quand la convergence
> est lente, et grossière quand elle est immédiate : pour `n = 1`, la première dichotomie
> tombe sur le taux exact alors que l'encadrement fait encore 0,01 de large, et le
> prototype rendait 0,025 au lieu de 0,03. C'est INV-007 qui l'a fait tomber. Corrigé dans
> `solveRate` ; le compteur d'itérations gagne une unité au passage.

**Cas de référence B** — mode taux, `P = 200 000 €`, `n = 240`, taux nominal `2,45 %` :

```
mensualité       1 054,94 €
coût total       53 185,77 €
capital final    0,00 €
```

**Cas de référence C** — coût nul, `P = 200 000 €`, `n = 240`, `C = 0` :

```
taux             0
mensualité       833,33 €
dernière échéance 834,13 €  (absorbe l'arrondi)
intérêts cumulés  0,00 €
```

**Cas limites à tester** : `n = 1` ; `n = 1200` ; `C` très grand devant `P` (taux élevé, le
doublement de l'encadrement doit tenir) ; entrées non numériques ou vides (message d'erreur
explicite, pas de `NaN` à l'écran) ; durée saisie en mois vs en années.

---

## 7. Ce qui existe déjà (prototype de référence)

Un prototype **monofichier** (`index.html`, HTML + CSS + JS vanilla, SheetJS via CDN) a été
produit et vérifié : solveur, échéancier, graphique, export CSV et export XLSX à formules.
Toutes les valeurs du §6 en sont issues et ont été contrôlées en exécution.

Statut : **référence de calcul et maquette d'interface**, pas une base de code imposée. Si
la phase 0 fait remonter une brique open source qui fait mieux, on la prend, à condition de
conserver les invariants du §6 et les conventions du §4.

Le prototype prend le parti de rester en une seule page sans build. Si la phase 0 conduit à
un vrai projet (bundler + tests), le découpage attendu est :

```
src/
  core/        # calcul pur, sans DOM : payment, solveRate, buildSchedule
  export/      # csv.js, xlsx.js
  ui/          # rendu, formatage, graphique
tests/         # les invariants du §6
```

---

## 8. Contraintes techniques et conventions

- **Hébergement GitHub Pages**, servi sous un sous-chemin `/<nom-du-repo>/`. Aucun chemin
  absolu commençant par `/`. Si un bundler est introduit, configurer la `base` en
  conséquence. C'est un piège déjà rencontré sur un autre projet.
- **Aucun backend, aucune télémétrie.** Tout le calcul se fait dans le navigateur, et
  l'interface le dit.
- **Code en anglais** : noms de variables, de fonctions, de fichiers, commentaires, messages
  de commit. Le repo est intégralement en anglais.
- **Interface en français**, format `fr-FR` pour les nombres, les montants et les dates.
- Qualité de base non négociable : responsive jusqu'au mobile, focus clavier visible,
  `prefers-reduced-motion` respecté, tableau navigable au clavier.
- Attribuer les briques réutilisées (nom, licence) en pied de page.

---

## 9. Attendu de fin de session

1. Le comparatif open source de la phase 0 et la décision associée.
2. Le code, sur une branche dédiée (nom à me demander, ne pas la créer d'office).
3. Les tests des invariants du §6, verts.
4. Un `README.md` : ce que fait l'outil, les conventions de calcul du §4, les briques
   réutilisées et leurs licences, la procédure de déploiement Pages.
5. Une proposition de message de commit. **Ne pas commiter sans demande explicite.**
