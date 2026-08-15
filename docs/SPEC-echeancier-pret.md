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
- taux mensuel résolu, taux annuel nominal (proportionnel), taux annuel équivalent (actuariel),
- coût total effectif et écart avec l'hypothèse saisie,
- l'équation avec les valeurs substituées, plus le nombre d'itérations et l'écart résiduel
  du solveur. C'est l'élément de transparence central : il montre *comment* le taux a été trouvé.

**Échéancier**, une ligne par mensualité, colonnes :

`N° | Échéance (date) | Mensualité | Intérêts | Capital amorti | Capital restant dû | Intérêts cumulés | Capital remboursé cumulé`

Regroupement par année civile avec ligne de sous-total, et deux vues : détail mensuel /
synthèse annuelle seule.

**Graphique** : capital restant dû et intérêts cumulés sur le même axe, avec lecture au
survol (échéance pointée, intérêts, capital, reste dû).

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

### 4.4 Conventions de taux

- Taux annuel **nominal** = `i × 12` (taux proportionnel, convention des offres de prêt françaises).
- Taux annuel **équivalent** (actuariel) = `(1 + i)^12 − 1`. Les deux sont affichés, jamais confondus.
- Le périmètre est **hors assurance emprunteur, frais de dossier, garantie et frais annexes** :
  ce n'est pas un TAEG, et l'interface doit le dire.

### 4.5 Hors périmètre (v1)

Assurance emprunteur, remboursements anticipés, différé d'amortissement, taux variable,
prêts in fine, multi-lignes de prêt, palier de mensualité. À garder à l'esprit dans la
structure du code, à ne pas implémenter.

---

## 5. Export XLSX à formules vivantes

Exigence structurante, elle porte la promesse de transparence : le classeur exporté doit
**se recalculer tout seul** si on modifie une hypothèse dedans.

**Onglet `Hypothèses`** : capital en `B2`, nombre de mensualités en `B3`, taux mensuel en
`B4`, mensualité en `B5`, coût total en `B6`, taux annuel nominal en `B7` (`=B4*12`), taux
équivalent en `B8` (`=(1+B4)^12-1`).

**Onglet `Échéancier`**, en-têtes ligne 1, une ligne par échéance à partir de la ligne 2 :

| Colonne | Ligne 2 (première échéance) | Lignes suivantes |
|---|---|---|
| D — Intérêts | `=ROUND('Hypothèses'!$B$2*'Hypothèses'!$B$4;2)` | `=ROUND(F{n-1}*'Hypothèses'!$B$4;2)` |
| C — Mensualité | `='Hypothèses'!$B$5` | idem, **sauf dernière ligne** : `=D{n}+E{n}` |
| E — Capital amorti | `=C2-D2` | idem, **sauf dernière ligne** : `=F{n-1}` |
| F — Capital restant dû | `='Hypothèses'!$B$2-E2` | `=F{n-1}-E{n}` |
| G — Intérêts cumulés | `=D2` | `=G{n-1}+D{n}` |
| H — Capital remboursé | `=E2` | `=H{n-1}+E{n}` |

Chaque cellule porte **la formule et la valeur** (`{t:"n", f:"…", v:…}` côté SheetJS), pour
que le classeur s'affiche correctement avant même le premier recalcul.

Point de vigilance validé sur le prototype : les références inter-onglets doivent être
**quotées** (`'Hypothèses'!$B$4`) à cause de l'accent dans le nom de l'onglet.

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

**INV-005 — Aller-retour des modes.** Résoudre le taux depuis un coût, puis réinjecter ce
taux en mode « je connais le taux », redonne le même échéancier au centime près.

**INV-006 — Monotonie.** La part d'intérêts décroît strictement et la part de capital croît
strictement d'une échéance à la suivante (hors dernière échéance ajustée), pour `i > 0`.

**INV-007 — Cas dégénéré `n = 1`.** La solution analytique est `i = C / P` : le solveur doit
la retrouver à `1e-9` près.

**Cas de référence A** — `P = 200 000 €`, `n = 240`, `C = 52 000 €` :

```
taux mensuel        0,0019992303  (0,199923 %)
taux annuel nominal 2,399 %
taux équivalent     2,426 %
mensualité          1 050,00 €
dernière échéance   1 049,96 €  (ajustée)
intérêts cumulés    51 999,96 €
convergence         47 itérations, résidu ~1,3e-11 €
```

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
