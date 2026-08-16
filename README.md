# Échéancier de prêt amortissable

**En ligne : <https://thomas-pourbaix.github.io/loan-schedule/>**

Application web statique qui résout le **taux** d'un prêt amortissable à partir de trois
hypothèses connues — capital emprunté, durée, coût cumulé des intérêts — puis déroule
l'échéancier mois par mois, l'exporte en tableur et en tire une **reconnaissance de dette
à imprimer et à signer**, échéancier annexé.

Elle est écrite pour le **prêt entre particuliers** : deux personnes s'accordent d'abord
sur une somme, une durée et ce que l'emprunt coûtera — un taux, ou un cumul d'intérêts —
et l'outil part de l'un ou de l'autre, l'inverse de l'ordre bancaire.

Le fil directeur est la transparence : aucun chiffre affiché n'est une boîte noire. Le
résultat se lit en **bilan à deux colonnes, souhaité et contractualisé**, ligne par ligne
et écart par écart, parce que la mensualité en euros ronds déplace la somme prêtée, le
taux et le coût par rapport à ce qui a été saisi. Sous le bilan ne subsiste qu'un rapport
d'échec — repli bancaire, marges introuvables, non-convergence : quand le calcul ne trouve
pas ce qui était demandé, il le dit, et quand il le trouve, le bilan l'a déjà montré. Les
conventions de calcul sont écrites en pied de page.

La somme empruntée se saisit **par tranches de 100 €** et le taux **par pas de 0,05
point** : c'est ainsi qu'un prêt entre particuliers se négocie. Une saisie intermédiaire
est ramenée au plus proche plutôt que refusée, et chaque champ concerné porte ses boutons
d'incrément.

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
- **La mensualité est un nombre entier d'euros** (voir la section suivante), identique de
  la première à la dernière échéance.
- À chaque échéance : `intérêts = round2(capital_restant_dû × i)`, puis
  `capital_amorti = round2(mensualité − intérêts)`.
- Repli, quand aucune mensualité ronde ne solde le prêt : la mensualité est arrondie au
  centime et **la dernière échéance absorbe la dérive** — elle solde exactement le capital
  et diffère donc des autres de quelques centimes, et elle est signalée comme ajustée.
  C'est la convention bancaire française ; elle ne gêne pas une banque, qui prélève le
  montant qu'elle veut, mais elle gêne un particulier qui rembourse par virement permanent.
- Taux annuel **nominal** = `i × 12` (taux proportionnel, convention des offres de prêt
  françaises). C'est le seul taux affiché : le taux **équivalent** (actuariel)
  `(1 + i)^12 − 1` est le TRI du prêteur sous hypothèse de réinvestissement, pas ce que
  l'emprunteur décaisse. `annualEquivalentRate` reste dans le noyau, exportée et testée.
- Il est **affiché par pas de 0,05 point**, le pas auquel il se saisit et se négocie, avec
  la valeur exacte retenue rappelée dessous : le taux qu'un solveur choisit pour faire
  tomber des euros ronds n'a pas quatre décimales significatives, il a la précision d'une
  contrainte. C'est l'échéancier qui porte la valeur contractuelle.
- **Un coût nul, ou un taux de 0 %, donne un prêt sans intérêt** (INV-014) : la mensualité
  vaut le capital divisé par la durée et rien n'est jamais ajouté pour l'arrondir.

Hors périmètre en v1 : assurance, remboursements anticipés, différé d'amortissement, taux
variable, prêts in fine, multi-lignes, paliers de mensualité.

## Mensualité en euros ronds

**La seule convention de l'outil**, et non plus une case à cocher : un prêt entre
particuliers se rembourse par virement permanent, et un virement permanent porte un nombre
entier d'euros. La mensualité est donc entière, **identique sur les `n` échéances sans
exception**, et le prêt se solde quand même à `0,00 €`.

Ce n'est pas un tour de passe-passe. Le taux est un paramètre **continu**, alors que le
solde final ne prend que des valeurs en centimes : pour une mensualité entière donnée, les
taux qui soldent exactement forment donc un intervalle. On cherche cet intervalle par
dichotomie ; quand il est vide — un pas peut enjamber zéro — on essaie la mensualité entière
suivante, un euro à la fois.

En pratique, un écart de 0 à 3 € par rapport à la mensualité idéale suffit toujours :

| Prêt | Mensualité idéale | Mensualité ronde | Taux retenu | Coût |
|---|---|---|---|---|
| 200 000 € / 240 mois | 1 050,00 € | **1 051 €** | 2,4094 % | 52 240 € |
| 200 000 € / 300 mois | 900,00 € | **900 €** | 2,5274 % | 70 000 € |
| 80 000 € / 180 mois | 555,56 € | **556 €** | 3,0917 % | 20 080 € |
| 10 000 € / 60 mois | 191,67 € | **192 €** | 5,7138 % | 1 520 € |

La contrepartie est que **le coût total n'est plus celui saisi** : il vaut exactement
`n × M − P`. C'est la raison d'être du bilan à deux colonnes — le déplacement de la
mensualité, le taux retenu et le nouveau coût se lisent en face de ce qui a été souhaité,
écart compris.

Quand aucune mensualité ronde ne solde le prêt, même en s'écartant de 24 €, le calcul
revient à la convention bancaire — mensualité au centime, dernière échéance ajustée — et
le dit à l'écran. Le noyau garde les deux chemins : `solveLoan` conserve son paramètre
`roundPayment`, c'est l'interface qui ne propose plus le choix.

**Le prêt sans intérêt échappe entièrement à cette recherche**, et c'est un invariant
(INV-014). Glisser la mensualité d'un euro suppose qu'un taux vienne compenser ; sur un
prêt à 0 %, il n'y a pas de taux à faire bouger, et 10 000 € sur 120 mois font 83,33 € par
mois, pas 84 €. Chercher quand même produisait 80 € d'intérêts que personne n'avait
consentis. Le seul degré de liberté qui subsiste est la somme prêtée, dans la marge
autorisée : 10 200 € sur 120 mois font 85 € tout rond, sans un centime d'intérêt. À défaut,
la mensualité garde ses centimes — c'est la dernière échéance qui les absorbe.

## Pouvoir d'achat

L'inflation est un paramètre, **2 % par défaut**, sous une case « vision inflation » qui
commande d'un bloc tout ce qui en découle : le bloc sous le bilan, les courbes en
pointillés du second graphique et les deux colonnes correspondantes des exports. Les
montants nominaux restent l'affichage principal — c'est ce qui quitte le compte chaque
mois — et cette lecture supplémentaire les restitue **en euros constants de la date de
départ**.

Le point à ne pas rater : chaque versement est déflaté **à sa propre date**, puis sommé.
Déflater le cumul final en bloc reviendrait à traiter vingt ans de versements comme s'ils
avaient tous eu lieu le dernier jour. Le déflateur est équivalent (actuariel),
`(1 + π)^(k/12)`, jamais `π/12`.

Le taux réel suit Fisher, `(1 + i) / (1 + π) − 1`, et non la soustraction `i − π` qui n'en
est que l'approximation. Il est nommé **« taux réel, net d'inflation »** à l'écran : « taux
réel » seul se lit comme « le vrai taux », ce qui est exactement le contresens à éviter.

Tout cela vit dans une **section « Effet de l'inflation »**, sous le bilan et non dedans :
le bilan dit ce qui sera signé, cette section dit ce que cela vaut. On y trouve aussi la
**fiscalité**, parce que l'inflation ne répond qu'à la moitié de la question que se pose le
prêteur. Les intérêts qu'il encaisse sont un revenu de placement à revenu fixe : ils
supportent le prélèvement forfaitaire unique de 30 % — 12,8 % d'impôt sur le revenu et
17,2 % de prélèvements sociaux — sauf option pour le barème
([service-public.fr](https://www.service-public.fr/particuliers/vosdroits/F2613), taux en
vigueur en 2026). La ligne affichée applique ce taux tel quel : elle est présentée comme un
ordre de grandeur, jamais comme une déclaration, et les chiffres qu'elle donne sont en gris,
pas dans l'encre des montants calculés.

Sur 200 000 € empruntés sur 240 mois à 52 000 € de coût, en mensualité ronde :

| | Nominal | En euros constants (2 % d'inflation) |
|---|---|---|
| Coût des intérêts | 52 240,00 € | **45 696,56 €** |
| Total versé | 252 240,00 € | **208 107,91 €** |
| Taux annuel | 2,4094 % | **0,4014 %** de taux réel |

À 5 % d'inflation le taux réel devient négatif (−2,4672 %) : le prêteur perd du pouvoir
d'achat en prêtant. Une valeur négative simule une déflation et joue en sens inverse.

## Marges de négociation

Un prêt entre particuliers ne porte pas sur des nombres libres : la somme se négocie par
tranches de 100 €, et le taux avec une marge. Deux champs « marge ± » permettent de le
dire, et le mode euros ronds passe alors de **un** degré de liberté à **trois** — capital,
mensualité, taux — ce qui le rend bien plus souvent soluble.

Exemple : 5 100 € à ±200 €, 3 % à ±0,1 %, sur 48 mois →
**5 100 € prêtés** (le montant exact demandé), **48 × 113 €**, taux **3,0512 %**,
coût 324 €, solde final `0,00 €`, une seule mensualité distincte.

Quand rien ne tient dans les marges, l'interface ne se contente pas de refuser : elle
chiffre **les deux concessions possibles**, séparément — de combien céder sur le taux à
marge de capital constante, ou de combien céder sur le capital à marge de taux constante,
en nommant le montant qui conviendrait. Céder sur l'un ou sur l'autre, ce ne sont pas les
mêmes discussions avec l'emprunteur.

## Exports

CSV point-virgule (BOM UTF-8, décimales à la virgule) et classeur XLSX à deux onglets —
`Hypothèses` et `Échéancier` — portant les **valeurs calculées** avec leurs formats de
nombre, jamais du texte pré-formaté.

La mise en page du classeur est **calculée à partir des données**, pas choisie à la main :
largeur de chaque colonne prise sur le plus large chiffre qu'elle imprime et sur le plus
long mot de son en-tête ; hauteur de la ligne d'en-tête prise sur le nombre de lignes que
les libellés occupent une fois repliés à cette largeur — sans quoi un tableur rogne un
en-tête replié à sa première ligne ; valeurs centrées sur les deux axes, une ligne sur deux
teintée, ligne d'en-tête et deux premières colonnes figées.

## Reconnaissance de dette, en PDF

Le troisième export est un **acte à imprimer, remplir à la main et signer**, avec
l'échéancier complet en annexe. Sa structure suit le modèle publié par l'[Institut national
de la consommation](https://www.inc-conso.fr/content/pret-dargent-un-proche-comment-etablir-une-reconnaissance-de-dettes) :
identités des deux parties, somme prêtée, date et mode de versement, conditions de
remboursement, intérêts, stipulations particulières, mention manuscrite et signatures.

Le partage entre ce qui est imprimé et ce qui est laissé en blanc est la seule règle de
mise en page :

- **imprimé** : tout ce que l'outil a calculé — somme, durée, mensualité, taux annuel
  nominal, coût des intérêts, total remboursé, dates de la première et de la dernière
  échéance. C'est la colonne « contractualisé » du bilan, sur papier. Personne n'a à
  recopier un chiffre ;
- **laissé libre** : tout ce que l'application ne sait pas et n'a pas à savoir — noms,
  dates et lieux de naissance, adresses, IBAN, lieu et date de signature. Chaque champ est
  une ligne réglée avec 25 points de hauteur d'écriture, soit environ 9 mm.

La mention manuscrite de l'article 1376 du code civil est imprimée **en modèle à recopier**,
somme en chiffres puis en toutes lettres (`src/core/words.js` écrit les montants en
français, `quatre-vingt-seize euros`), au-dessus de trois lignes vierges. Elle doit être de
la main de l'emprunteur : c'est ce qui donne à l'acte sa valeur de preuve, et c'est la somme
écrite en lettres qui l'emporte en cas de différence.

Le PDF est **écrit par ce projet**, sans bibliothèque (`src/export/pdf/`) : les polices
Helvetica des visionneuses, des flux de contenu non compressés — le fichier s'ouvre dans un
éditeur de texte et se lit — et les métriques Adobe pour couper les lignes, puisque aucune
visionneuse ne repliera un paragraphe à notre place. Vendoriser une bibliothèque PDF aurait
coûté quelques centaines de kilo-octets à auditer pour un document fait de texte, de filets
et de rectangles.

Le document porte son propre avertissement : c'est un modèle, il ne vaut pas conseil
juridique. Chaque page porte aussi, en pied, **la version de l'outil qui l'a écrite**
(`src/core/version.js`) : un acte est imprimé, classé, puis discuté des mois plus tard, et
« la mensualité est fausse » n'est instruisible que si l'on sait quel code a écrit la page
qu'on montre du doigt. Le classeur exporté porte la même mention parmi ses hypothèses, et
la page l'affiche dans son pied.

## Tests

Le moteur (`src/core/`) est pur : ni DOM, ni formatage, ni I/O. Les invariants sont donc
testables sans navigateur.

```bash
npm install
npm test
```

Les invariants couverts (INV-001 à INV-014) sont décrits dans
[docs/SPEC-echeancier-pret.md](docs/SPEC-echeancier-pret.md) §6 : remboursement intégral
du capital, conservation, nombre de lignes, fidélité à l'hypothèse de coût, aller-retour
entre les deux modes, monotonie des parts, cas dégénéré `n = 1`, euros constants, marges de
négociation respectées, et le prêt sans intérêt qui reste sans intérêt (INV-014).

Ce que la page **affirme** est testé comme le reste (`tests/page.test.js`) : la prose n'est
recompilée par rien, donc les rares phrases qui citent un chiffre que le code détient — les
taux de la fiscalité, la version — sont comparées à ce chiffre plutôt que crues sur parole.

Le PDF a ses propres tests (`tests/pdf.test.js`) : l'écrivain enregistre chaque tracé, ce
qui permet d'affirmer sans relire le fichier qu'aucune ligne ne sort de la page, que
l'annexe porte exactement une ligne par échéance et son en-tête sur chacune de ses pages,
et que les montants du bilan y figurent. Du fichier lui-même on vérifie ce qu'une
visionneuse exige : chaque décalage de la table de références croisées tombe bien sur son
objet. Les montants en toutes lettres sont testés à part (`tests/words.test.js`) —
`quatre-vingts` contre `quatre-vingt mille` n'est pas une coquette, c'est la somme qui fait
foi.

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

Le solveur, l'échéancier, le graphique, l'interface et l'écrivain PDF sont écrits pour ce
projet — aucune bibliothèque PDF n'est vendorisée.

## Structure

```
index.html          page unique, aucun build
src/core/           calcul pur, sans DOM — finance.js, format.js, words.js, version.js
src/export/         csv.js, xlsx.js
src/export/pdf/     écrivain PDF (metrics.js, document.js) et l'acte (deed.js)
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

**Branche servie : `main`**, à la racine — vérifiable à tout moment :

```bash
gh api repos/:owner/loan-schedule/pages
```

Les modules ES sont servis avec leur propre `cache-control: max-age=600`, indépendamment du
HTML : on peut donc lire un `index.html` neuf accompagné d'un `app.js` vieux de dix minutes.
D'où la version en pied de page — et, en cas de doute, la comparaison directe :

```bash
diff <(curl -sS https://thomas-pourbaix.github.io/loan-schedule/src/ui/app.js) src/ui/app.js
```

Tous les chemins de la page sont relatifs (`./src/…`, `./vendor/…`), ce qui permet de
servir le site depuis un sous-chemin `/<nom-du-repo>/` sans configuration.

## Licence

[AGPL-3.0-or-later](LICENSE). Le code source est accessible depuis l'interface, comme le
demande l'article 13 de la licence.
