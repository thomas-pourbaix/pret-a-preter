# Échéancier de prêt amortissable

Application web statique qui résout le **taux** d'un prêt amortissable à partir de trois
hypothèses connues — capital emprunté, durée, coût cumulé des intérêts — puis déroule
l'échéancier mois par mois et l'exporte en tableur.

Le fil directeur est la transparence : aucun chiffre affiché n'est une boîte noire.
L'équation avec ses valeurs substituées, le nombre d'itérations du solveur et son écart
résiduel sont affichés à l'écran, et l'écart d'arrondi entre le coût saisi et le coût
effectif est montré plutôt que masqué.

Tout le calcul se fait dans le navigateur. Aucun backend, aucune télémétrie, aucune
requête vers un tiers : polices et bibliothèque d'export sont servies depuis ce dépôt.

## Le problème résolu

La plupart des calculateurs demandent un taux et rendent une mensualité. Ici c'est
l'inverse : l'emprunteur connaît le montant, la durée et ce que le crédit lui coûte, mais
pas le taux. La mensualité cible est donc connue exactement,

```
M_cible = (P + C) / n
```

et il faut résoudre en `i` :

```
f(i) = P · i / (1 − (1 + i)^(−n)) − M_cible = 0
```

`f` étant strictement croissante en `i`, on encadre puis on dichotomise. Cette méthode ne
peut pas diverger, et le nombre d'itérations comme le résidu sont assez parlants pour
être affichés.

Le choix de ne pas réutiliser une fonction `RATE` existante est délibéré et documenté :
les implémentations par Newton-Raphson des tableurs (Formula.js notamment) **renvoient
leur dernière itérée sans rien signaler** quand elles ne convergent pas, ce qui est
incompatible avec la promesse de cet outil. Elles restent utilisées, mais en test, comme
oracles indépendants (voir plus bas).

## Conventions de calcul

- Mensualité constante, intérêts calculés sur le capital restant dû au taux mensuel `i`.
- La mensualité est arrondie au centime une fois pour toutes.
- À chaque échéance : `intérêts = round2(capital_restant_dû × i)`, puis
  `capital_amorti = round2(mensualité − intérêts)`.
- **La dernière échéance absorbe la dérive** : elle solde exactement le capital et se
  trouve donc différer des autres de quelques centimes. Elle est signalée comme ajustée.
- Taux annuel **nominal** = `i × 12` (taux proportionnel, convention des offres de prêt
  françaises). Taux annuel **équivalent** (actuariel) = `(1 + i)^12 − 1`. Les deux sont
  affichés, jamais confondus.
- Périmètre : **hors assurance emprunteur, frais de dossier, garantie et frais annexes**.
  Ce n'est pas un TAEG.

Hors périmètre en v1 : assurance, remboursements anticipés, différé d'amortissement, taux
variable, prêts in fine, multi-lignes, paliers de mensualité.

## Tests

Le moteur (`src/core/`) est pur : ni DOM, ni formatage, ni I/O. Les invariants sont donc
testables sans navigateur.

```bash
npm install
npm test
```

Les invariants couverts (INV-001 à INV-007) sont décrits dans
[docs/SPEC-echeancier-pret.md](docs/SPEC-echeancier-pret.md) §6 : remboursement intégral
du capital, conservation, nombre de lignes, fidélité à l'hypothèse de coût, aller-retour
entre les deux modes, monotonie des parts, et cas dégénéré `n = 1`.

Le taux résolu est en outre **vérifié en croisé** contre deux implémentations tierces et
indépendantes de la fonction `RATE` des tableurs. Elles sont en `devDependencies`
uniquement : rien de tout cela n'est servi au navigateur.

### Une correction apportée à la spécification

INV-004 énonçait `|Σ intérêts − C| ≤ 0,05 €`. Cette borne tient sur le cas de référence A
dont elle est tirée, mais **ce n'est pas un théorème** : arrondir les intérêts au centime
à chaque échéance peut dériver d'un demi-centime par période, et c'est la dérive en
*capital*, non en intérêts, que la dernière mensualité absorbe. Le cas
`P = 12 345,67 €, n = 37, C = 987,65 €` atteint six centimes. La borne réellement
garantie par les conventions ci-dessus est `0,005 × n + 0,01`, et c'est elle qui est
testée dans le cas général.

## Briques réutilisées

| Brique | Rôle | Licence |
|---|---|---|
| [write-excel-file](https://gitlab.com/catamphetamine/write-excel-file) 4.1.1 | écriture du `.xlsx` | MIT |
| [IBM Plex](https://github.com/IBM/plex) | polices | OFL-1.1 |
| [@formulajs/formulajs](https://github.com/formulajs/formulajs) | oracle de test `RATE` / `PMT` | MIT |
| [tvm-financejs](https://github.com/kgkars/tvm-financejs) | second oracle de test `RATE` | MIT |
| [Vitest](https://vitest.dev/) | exécution des tests | MIT |

Seules les deux premières lignes sont servies au navigateur ; elles sont vendorisées dans
`vendor/`, avec leur texte de licence. Toutes ces licences sont compatibles avec une
redistribution sous AGPL-3.0.

Le solveur, l'échéancier, le graphique et l'interface sont écrits pour ce projet.

## Structure

```
index.html          page unique, aucun build
src/core/           calcul pur, sans DOM — finance.js, format.js
src/export/         csv.js, xlsx.js
src/ui/             app.js, chart.js, table.js
vendor/             write-excel-file et polices, avec leurs licences
tests/              les invariants
docs/               la spécification fonctionnelle
```

Les modules sont des modules ES natifs, chargés tels quels par le navigateur et importés
directement par Vitest. Il n'y a **pas d'étape de build** : ce qui est dans le dépôt est
ce qui est servi. C'est aussi ce qui évite le piège des chemins absolus sur GitHub Pages.

## Développement local

```bash
python3 -m http.server 4173
```

puis <http://localhost:4173>. Un serveur est nécessaire : les modules ES ne se chargent
pas depuis `file://`.

## Déploiement

Le site est publié par GitHub Pages, à la racine du dépôt. Il n'y a rien à construire :
pousser suffit.

Réglage : *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
dossier `/ (root)`.

**Branche servie actuellement : `feat/loan-schedule`**, le temps que le travail soit relu.
Une fois la branche fusionnée, basculer Pages sur `main` :

```bash
gh api -X POST repos/:owner/loan-schedule/pages -f source[branch]=main -f source[path]=/
```

Tous les chemins de la page sont relatifs (`./src/…`, `./vendor/…`), ce qui permet de
servir le site depuis un sous-chemin `/<nom-du-repo>/` sans configuration.

## Licence

[AGPL-3.0-or-later](LICENSE). Le code source est accessible depuis l'interface, comme le
demande l'article 13 de la licence.
