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
| Dernier commit | `939da75` |

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
   coût. Un troisième bouton « je connais la mensualité » serait plus honnête —
   « je veux payer 1 000 € par mois pendant 20 ans, ça fait quel taux ? ».
3. **Numéro de version en pied de page**, pour savoir d'un coup d'œil si l'on regarde la
   dernière version déployée (voir le piège du cache).
4. **Valeurs par défaut des marges** : actuellement ±0, donc la fonctionnalité est inerte
   tant qu'on ne la règle pas. Choix conservateur assumé, à réévaluer à l'usage.
5. Hors périmètre v1, mentionné pour mémoire : assurance emprunteur, remboursements
   anticipés, différé d'amortissement, taux variable, prêts in fine, paliers de mensualité.

---

## 7. Pour démarrer

Lire dans l'ordre : ce fichier, puis `README.md` (ce que fait l'outil et pourquoi), puis
`docs/SPEC-echeancier-pret.md` §4 (conventions de calcul) et §6 (les dix invariants).
Lancer `npx vitest run` pour vérifier que le socle est sain avant de toucher à quoi que ce
soit.
