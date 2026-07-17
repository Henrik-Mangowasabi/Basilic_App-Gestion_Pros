# MM Gestion Pros Santé — Trame Projet

> Document de référence pour le développement. Mis à jour au fil des versions.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Architecture fichiers](#3-architecture-fichiers)
4. [Pages & fonctionnalités](#4-pages--fonctionnalités)
5. [Shopify — Données & API](#5-shopify--données--api)
6. [Système de crédits boutique](#6-système-de-crédits-boutique)
7. [Import CSV/Excel](#7-import-csvexcel)
8. [Webhooks](#8-webhooks)
9. [Base de données](#9-base-de-données)
10. [UI Kit Basilic](#10-ui-kit-basilic)
11. [Roadmap des modifications](#11-roadmap-des-modifications)
12. [Règles de dev](#12-règles-de-dev)

---

## 1. Vue d'ensemble

**Nom :** Basilic App — Gestion Pros Santé
**But :** Application Shopify embarquée (embedded app) pour gérer les partenaires professionnels de santé d'une boutique.
**Déploiement :** Render.com — `https://mm-gestion-pros-sante.onrender.com`
**Store unique :** L'app est installée sur un seul store Shopify. La logique multi-store (DB partagée) doit être simplifiée/supprimée.

---

## 2. Stack technique

| Technologie | Version | Rôle |
|---|---|---|
| React Router | 7.9.3 | Framework full-stack (routing + SSR) |
| React | 18.3.1 | UI |
| TypeScript | 5.9.3 | Typage |
| Vite | 6.3.6 | Build |
| @shopify/shopify-app-react-router | 1.1.0 | Auth + session Shopify |
| @shopify/polaris | 13.9.5 | UI (remplacée progressivement par Basilic UI Kit) |
| SQLite (sessions.db) | — | Sessions OAuth uniquement (disque persistant Render) |
| Metaobjects Shopify | — | « Base de données » métier (pas de DB externe) |
| XLSX | 0.18.5 | Parsing Excel/CSV |
| Vitest | 4.x | Tests unitaires (`npm test` — logique de paliers) |

---

## 3. Architecture fichiers

```
mm-gestion-pros-sante/
├── app/
│   ├── routes/
│   │   ├── app.tsx                            # Layout root + navigation + config globale
│   │   ├── app._index.tsx                     # Page principale — vues Pros / Code Promo / CA / Limitation
│   │   ├── app.analytique.tsx                 # Dashboard analytique (requêtes live par lots)
│   │   ├── app.validation.tsx                 # Validation des pros en attente (Klaviyo)
│   │   ├── app.tutoriel.tsx                   # Guide d'utilisation + Danger Zone
│   │   ├── app.diagnostic-credits.tsx         # 🔎 Page diagnostic (audit CA/crédits/doublons)
│   │   ├── app.api.import.tsx                 # API : upsert d'un pro (import batch client)
│   │   ├── app.api.recalculate-all.tsx        # API : recalcul global du CA (SSE)
│   │   ├── app.api.recalculate-cache.tsx      # API : recalcul CA d'un pro (REST paginé + fallback)
│   │   ├── app.api.recalculate-credits.tsx    # API : dépôt des crédits manquants d'un pro
│   │   ├── app.api.recalibrate-remainders.tsx # API : recalibrage des accumulateurs en masse
│   │   ├── app.api.rename-discounts.tsx       # API : renommage en masse des discounts (SSE)
│   │   ├── app.api.verify-password.tsx        # API : vérification serveur du mot de passe édition
│   │   ├── webhooks.orders.create.tsx         # Webhook commandes (crédits temps réel)
│   │   ├── webhooks.orders.cancelled.tsx      # Webhook annulations (recalc CA)
│   │   ├── webhooks.refunds.create.tsx        # Webhook remboursements (recalc CA)
│   │   ├── webhooks.discounts.delete.tsx      # Webhook suppression discount (avec garde-fou)
│   │   ├── webhooks.customers.delete.tsx      # Webhook suppression client
│   │   ├── webhooks.klaviyo.tsx               # Webhook entrant Klaviyo (pros en attente)
│   │   └── webhooks.app.uninstalled.tsx
│   ├── lib/
│   │   ├── metaobject.server.ts       # CRUD metaobjects + updateMetaobjectFields (unique)
│   │   ├── discount.server.ts         # CRUD codes promo + garde-fou codesBeingRecreated
│   │   ├── customer.server.ts         # Clients + depositStoreCredit (unique)
│   │   ├── orders.server.ts           # Requêtes commandes par lots + recalculateProCache
│   │   ├── credits.ts                 # ⚖️ Logique PURE des paliers (testée)
│   │   ├── credits.test.ts            # 13 tests vitest
│   │   ├── security.server.ts         # Comparaison à temps constant
│   │   └── logger.server.ts           # Logger
│   ├── components/                    # NavBar, Pagination, ErrorDisplay + ui/ (Basilic UI Kit)
│   ├── context/EditModeContext.tsx    # Mode édition + config + Réglage Date
│   ├── config.server.ts               # Config shop metafields (seuils, montants, date)
│   ├── shopify.server.ts              # Init Shopify API (sessions SQLite)
│   └── root.tsx                       # Layout HTML racine
└── PROJET.md                          # Ce fichier
```

---

## 4. Pages & fonctionnalités

### 4.1 Gestion Pros Santé (`/app` — page principale)

**C'est la page centrale de l'app.** Elle contient :

#### Tableau des partenaires
Colonnes actuelles :
- Référence interne
- Prénom + Nom (fusionnés — **à séparer**)
- Email
- Profession
- Adresse
- Code promo
- Montant
- Type (% ou €)
- Statut (actif/inactif)
- Actions (modifier, supprimer)

#### Actions disponibles
- **Ajouter un partenaire** (modal) — champs : référence, prénom, nom, email, profession, adresse, code promo, montant, type
- **Modifier un partenaire** (inline ou modal) — synchronise client Shopify + code promo
- **Supprimer un partenaire** — supprime le métaobjet, le code promo, retire le tag client
- **Mode édition verrouillé** par mot de passe (actuellement `"GestionPro"` hardcodé)

#### Import CSV/Excel
- Bouton d'import en haut de page
- Rapport post-import (ajoutés, ignorés, doublons, erreurs)

#### Réglages Crédits Store (sidebar)
- Seuil de CA par palier (500 €)
- Montant du crédit illimité (75 €)
- Montant réglementé annuel — loi anti-cadeaux (60 €)
- Stockés en shop metafields (`basilic_config.*`) — voir section 9

---

### 4.2 Gestion Codes Promo (`/app/codes_promo`)

Vue simplifiée de tous les codes promo liés aux pros :
- Nom du code
- Montant + Type
- Statut (toggle actif/inactif)
- Lien direct vers le code dans Shopify
- Nom du professionnel associé

Action principale : **activer / désactiver** un code promo (met à jour `endsAt` dans Shopify).

---

### 4.3 Gestion Chiffre d'affaires (`/app/clients`)

Vue analytique par pro :
- Nom du professionnel
- Code promo lié
- Nombre de commandes
- CA total généré
- Crédits gagnés (calculé)
- Crédits utilisés
- Crédits restants (depuis le compte Store Credit Shopify)

---

### 4.4 Analytique (`/app/analytique`)

Statistiques globales avec filtre par période :
- Total commandes
- CA total
- Nombre de pros actifs
- Nombre de pros enregistrés
- Classement des pros par CA (top performers)

---

### 4.5 Guide d'utilisation (`/app/tutoriel`)

Page statique d'onboarding pour guider l'admin.

---

## 5. Shopify — Données & API

### 5.1 Métaobjet `mm_pro_de_sante`

Type custom créé automatiquement à l'installation. Stocke toutes les données d'un partenaire pro.

| Champ | Clé | Type Shopify | Obligatoire |
|---|---|---|---|
| Référence | `identification` | single_line_text | ✓ |
| Nom complet (legacy) | `name` | single_line_text | — |
| Prénom | `first_name` | single_line_text | ✓ |
| Nom | `last_name` | single_line_text | ✓ |
| Email | `email` | single_line_text | ✓ |
| Code promo | `code` | single_line_text | ✓ |
| Montant | `montant` | number_decimal | ✓ |
| Type | `type` | choice (%, €) | ✓ |
| ID code promo | `discount_id` | single_line_text | — |
| Statut | `status` | boolean | — |
| ID client | `customer_id` | single_line_text | — |
| Profession | `profession` | single_line_text | — |
| Adresse | `adresse` | single_line_text | — |
| CA (cache) | `cache_revenue` | number_decimal | — |
| Nb commandes (cache) | `cache_orders_count` | number_integer | — |
| Crédits gagnés (cache) | `cache_credit_earned` | number_decimal | — |
| Accumulateur palier | `cache_ca_remainder` | number_decimal | — |
| Statut rémunération | `remuneration_type` | single_line_text (`illimite` / `limite_annee` / `sans_remuneration`) | — |
| Bloqué le | `limitation_date` | single_line_text (YYYY-MM-DD) | — |
| Débloqué le | `limitation_unlock_date` | single_line_text (YYYY-MM-DD) | — |

> ⚠️ Le champ legacy `name` est toujours écrit à la création — il DOIT exister dans la
> définition (présent dans `createMetaobject` + migration), sinon toute création échoue.
> ⚠️ Un code promo = UNE seule fiche : les doublons de code faussent les compteurs
> (détectés par la page Diagnostic).

---

### 5.2 Metafields client

Créés automatiquement sur la fiche client Shopify :

| Namespace | Clé | Type | Contenu |
|---|---|---|---|
| `custom` | `profession` | single_line_text_field | Profession du pro |
| `custom` | `adresse` | single_line_text_field | Adresse du pro |
| `custom` | `code_promo` | single_line_text_field | Code promo lié (**à créer**) |
| `custom` | `ca_genere` | number_decimal | CA total généré (**à créer**) |

> **Modification prévue (V0)** : Ajouter les metafields `code_promo` et `ca_genere` sur la fiche client, mis à jour dynamiquement.

---

### 5.3 Code promo Shopify

Type : `DiscountCodeBasic`

- **Création** : lors de l'ajout d'un partenaire
- **Mise à jour** : lors de la modification (code, montant, type)
- **Toggle** : `endsAt = null` (actif) / `endsAt = maintenant` (inactif)
- **Suppression** : lors de la suppression du partenaire
- **Lié au client** : le client est retrouvé via son email, taggué `pro_sante`

---

### 5.4 Client Shopify

Lors de l'ajout d'un partenaire :
1. Recherche du client par email
2. S'il existe → ajout du tag `pro_sante`
3. S'il n'existe pas → création avec email, prénom, nom
4. Mise à jour des metafields (profession, adresse)
5. Mise à jour de l'adresse par défaut

---

### 5.5 Scopes Shopify requis

```
read_customers, write_customers
read_discounts, write_discounts
read_metaobjects, write_metaobjects, write_metaobject_definitions
read_products, write_products
read_locales
read_orders
read_store_credit_accounts
write_store_credit_account_transactions
```

---

## 6. Système de crédits boutique

> ⚖️ **Loi anti-cadeaux (juillet 2026)** : le système distingue désormais les professions
> réglementées (médecins, sages-femmes, kinés, pharmaciens, ostéos…) des non-réglementées
> (naturopathes, doulas, accompagnantes périnatales…). Le statut se règle **par pro**
> (champ `remuneration_type`) via la modale d'édition ou la vue Gestion Limitation.

### Trois statuts de rémunération

| Statut (`remuneration_type`) | Règle | Public |
|---|---|---|
| `illimite` (défaut) | **75€** versés à chaque tranche de **500€** de CA (N paliers possibles) | Non-réglementées |
| `limite_annee` | **60€** max (montant réglementé), 1 seule fois par an, au 1er franchissement de 500€ → blocage 12 mois (`limitation_unlock_date`) | Réglementées |
| `sans_remuneration` | Aucun crédit, jamais — le CA reste compté pour les stats | Réglementées (choix strict) |

Les trois montants (seuil / montant illimité / montant réglementé annuel) se règlent dans
la sidebar → **Réglages Crédits** (shop metafields `basilic_config.credit_threshold`,
`credit_amount`, `regulated_credit_amount`).

### Base de calcul du CA

- **CA = `subtotalPriceSet` (post-réduction, hors livraison, hors taxes)**, remboursements produits déduits — même formule dans le webhook, l'analytique et tous les recalculs.
- **Réglage Date** (sidebar, vue CA) : date plancher persistée en shop metafield (`basilic_config.recalc_from_date`) et respectée par TOUS les chemins (webhook remboursement/annulation compris). **Décision business : base = CA depuis le 03/03/2026** (go-live du programme) — le CA antérieur ne donne aucun droit.

### Mécanique des paliers (accumulateur)

- `cache_ca_remainder` accumule le CA commande par commande (0 → seuil). Quand il atteint 500€ → dépôt du crédit → soustraction du seuil.
- **Le crédit n'est compté (`cache_credit_earned`) QUE si le virement Store Credit Shopify réussit.** En cas d'échec, l'accumulateur reste intact et le prochain webhook réessaie — plus jamais de « crédits fantômes ».
- La logique de paliers est une fonction pure testée : `app/lib/credits.ts` (`computeCreditsForOrder`, 13 tests vitest — `npm test`).
- Le dépôt Store Credit passe exclusivement par `depositStoreCredit()` (`customer.server.ts`) : devise du shop, vérification des `userErrors`.

### Recalculs (règles strictes)

| Outil | Ce qu'il touche | Ce qu'il ne touche JAMAIS |
|---|---|---|
| « Recalculer » (global, vue CA) | `cache_revenue` + `cache_orders_count` (depuis la Réglage Date) | crédits & accumulateur |
| « Recalculer le CA » (⋯ par pro, REST paginé) | idem, pour 1 pro — **seul outil fiable si l'index Shopify du code est cassé** (discount recréé) | crédits & accumulateur |
| « Recalculer les crédits » (⋯ par pro) | dépose l'écart (attendus − versés) + recale l'accumulateur. **Réservé aux illimitées** (verrouillé sinon) | le CA |
| « Recalibrer paliers » (global, mode édition) | `cache_ca_remainder` = CA % seuil, en masse — uniquement pour les pros dont les crédits sont déjà exactement à jour | crédits, CA, pros non soldés/réglementées |

---

## 7. Import CSV/Excel

### Format accepté

Excel `.xlsx` ou CSV avec colonnes flexibles (accents tolérés) :

| Colonne source | Champ cible |
|---|---|
| Ref Interne / Ref / Reference / ID | `identification` |
| Prénom / Prenom | `first_name` (**après refacto**) |
| Nom / Name | `last_name` (**après refacto**) |
| Email / Mail / Courriel | `email` |
| Code / Code Promo / Promo | `code` |
| Montant / Amount / Valeur | `montant` |
| Type | `type` (% ou €) |
| Profession / Job / Métier | `profession` |
| Adresse / Address / Ville | `adresse` |

### Comportement

- Validation des champs obligatoires (ref, nom, email, code)
- Dédoublonnage (code + ref existants ignorés)
- Traitement séquentiel (fiable pour l'API Shopify)
- Rapport en fin d'import : ajoutés / ignorés / doublons / erreurs

---

## 8. Webhooks

### `orders/create` (HMAC manuel)

Déclenché à chaque nouvelle commande.

1. Validation HMAC (comparaison à temps constant) + parsing
2. **Réponse HTTP 200 immédiate**, puis traitement en tâche de fond (`processOrderWebhook`) — Shopify exige < 5 s, sinon re-livraison = double comptage
3. Collecte de **TOUS les codes promo** de la commande (`discount_codes` + fallback `discount_applications` via GraphQL) — chaque pro correspondant est crédité
4. Par code (`processEarnForCode`) : recherche du pro (indexée puis exhaustive ≤ 5 000), calcul des paliers selon le statut (`computeCreditsForOrder`), dépôt Store Credit **puis seulement** avancement des compteurs, mise à jour du metaobject (`updateMetaobjectFields`) et du metafield `ca_genere`

### `orders/cancelled` et `refunds/create` (HMAC manuel)

Recalculent le cache CA du/des pros concernés via `recalculateProCache()` —
en respectant la Réglage Date (le CA filtré n'est jamais écrasé par l'historique complet).
Ne touchent jamais crédits/accumulateur.

### `discounts/delete`

Si un discount lié à un pro est supprimé dans Shopify :
- **Garde-fou anti-suppression accidentelle** : si la suppression vient du flow interne
  delete+recreate (`codesBeingRecreated`), ou si un discount avec le même code existe
  à nouveau → resynchronise le `discount_id` au lieu de supprimer le pro
- Sinon : supprime la fiche pro + nettoie tag/metafield client

### `customers/delete`

Supprime la fiche pro (metaobject + discount) liée au client supprimé.

### Webhook entrant Klaviyo (`/webhooks/klaviyo`, secret partagé en query)

Crée/tague le client Shopify (`pro_pending` + metafield `pro_en_attente_de_validation`)
quand un pro postule via un flow Klaviyo → alimente la page Validation.

### `app/uninstalled`

Nettoyage de la session lors de la désinstallation.

---

## 9. Base de données

**Il n'y a PAS de base de données externe** (décision d'architecture — pas de MO orders log,
pas de Prisma/PostgreSQL) :

- **Sessions OAuth** : SQLite local (`sessions.db`, disque persistant Render) via `@shopify/shopify-app-session-storage-sqlite`
- **Données pros** : metaobjects Shopify `mm_pro_de_sante` (source de vérité)
- **Configuration** : shop metafields, namespace `basilic_config` :

| Clé | Type | Rôle | Défaut |
|---|---|---|---|
| `credit_threshold` | number_decimal | Seuil de CA par palier | 500€ |
| `credit_amount` | number_decimal | Crédit par palier (illimité) | 75€ |
| `regulated_credit_amount` | number_decimal | Bon annuel unique (limité annuel / loi anti-cadeaux) | 60€ |
| `recalc_from_date` | single_line_text | Date plancher des calculs de CA (Réglage Date) | 2026-03-03 |
| `validation_value` / `validation_type` / `validation_code_prefix` | — | Défauts pour la page Validation | 5 / % / PRO_ |

---

## 9bis. Outils d'administration & diagnostic

### Page Diagnostic (`/app/diagnostic-credits`)

Audit complet de la base, à lancer **~1×/mois** ou en cas de doute (accès : URL directe
dans l'admin, éventuellement `?codes=CODE1,CODE2` pour cibler, `?appDate=YYYY-MM-DD`
pour changer la date de référence).

Pour chaque pro, la page recompte le CA réel sur **tout l'historique** de commandes
(l'app a le scope `read_all_orders`), le découpe avant/depuis la date de lancement,
et compare aux compteurs en cache. Elle détecte :

- **⚠ CA désynchronisé** (cache ≠ CA depuis le lancement) → « Recalculer le CA »
- **👻 Crédits fantômes** : compteur `cache_credit_earned` sans transactions Store Credit
  réelles (héritage d'un ancien bug) → corriger le champ dans le metaobject
- **🚨 Codes en double** : 2 fiches sur le même code → supprimer le doublon via
  Contenu → Metaobjects (PAS via l'app, qui supprimerait le code promo partagé)
- **Dépôts en attente** : bloc `depots_a_faire` en tête de JSON = liste compacte
  (code, nom, montant) triée du plus gros au plus petit + total

### Cas particulier : index Shopify cassé (scénario « Maud »)

Quand un discount a été supprimé/recréé, la recherche `discount_code:X` de Shopify ne
retrouve plus les anciennes commandes → **le recalcul global affiche 0€** pour ce pro.
Seul le **recalcul individuel** (⋯ → Recalculer le CA, qui passe par la REST API) retrouve
les commandes. Après un recalcul global, toujours vérifier les pros retombés à 0.

### Vérification manuelle d'un crédit

Fiche client Shopify → Crédit en magasin → transactions : chaque versement de l'app
apparaît avec la source « Basilic App - Pros - JM ». Un compteur « gagné » sans
transaction correspondante = fantôme.

---

## 10. UI Kit Basilic

### Principe

Remplacer **Shopify Polaris** par le **Basilic UI Kit** custom (React + CSS vanilla, zéro dépendance externe).

### Fichiers à intégrer (depuis `app-mm-mo-mf`)

```
app/components/ui/          → 13 composants React custom
app/styles/ui-kit.css       → Variables CSS (tokens)
app/styles/basilic-ui.css   → Design system complet
```

### Composants disponibles

| Composant | Usage |
|---|---|
| `Button` | Boutons (solid, flat, light, ghost, bordered) |
| `Modal` | Modales (portal, Escape, scroll-lock) |
| `Table` | Tableaux avec sélection multiple |
| `Input` | Champs texte avec label, clear, erreur |
| `Switch` | Toggle on/off |
| `Dropdown` | Menu contextuel (portal, auto-close) |
| `Tabs` | Onglets (solid, bordered, underlined) |
| `Card` | Cartes (pressable, hoverable) |
| `Chip` | Badges/étiquettes colorés |
| `Tooltip` | Info-bulles |
| `Pagination` | Navigation pages |
| `Divider` | Séparateurs H/V |

### Design Tokens principaux

```css
--color-primary: #4BB961;
--color-primary-dark: #15803D;
--color-danger: #d14444;
--color-info: #3B82F6;
--color-gray-900: #18181B;  /* texte principal */
--color-gray-100: #F4F4F5;  /* fond clair */
--color-white: #FFFFFF;

--radius-md: 12px;
--radius-lg: 16px;
--radius-full: 9999px;

--space-4: 1rem;   /* 16px */
--space-6: 1.5rem; /* 24px */
```

### Règles de migration

- **Ne jamais** utiliser Tailwind, HeroUI, NextUI, shadcn
- **Toujours** utiliser les composants de `~/components/ui`
- **Toujours** utiliser les variables CSS `--color-*`, `--space-*`, `--radius-*`
- Les styles custom vont dans `app/styles/` en CSS classique (convention BEM-like)
- Suppression progressive des imports `@shopify/polaris`

---

## 11. Roadmap des modifications

### V0 — Finalisation (en cours)

#### Corrections fonctionnelles

- [ ] **Séparer Prénom / Nom** en deux colonnes distinctes dans le tableau et les formulaires
  - Mettre à jour le métaobjet (`first_name` + `last_name` au lieu de `name`)
  - Adapter le formulaire d'ajout/modification
  - Adapter l'import CSV (colonnes Prénom et Nom séparées)
  - Adapter la synchronisation client Shopify

- [ ] **Metafield `code_promo`** sur la fiche client Shopify
  - Créer la définition metafield (`custom.code_promo`, type `single_line_text_field`, owner `CUSTOMER`)
  - Injecter le code promo à la création du partenaire
  - Mettre à jour si le code promo change

- [ ] **Metafield `ca_genere`** sur la fiche client Shopify
  - Créer la définition metafield (`custom.ca_genere`, type `number_decimal`, owner `CUSTOMER`)
  - Mettre à jour dynamiquement à chaque commande (webhook `orders/create`)
  - Mettre à jour lors d'une modif manuelle du CA

#### Simplification architecture

- [ ] **Supprimer la logique multi-store**
  - Le champ `shop` dans `Config` est gardé pour compatibilité Shopify mais inutile en pratique
  - Retirer tout code conditionnel basé sur plusieurs shops
  - Simplifier les requêtes BDD (retirer les `.findMany({ where: { shop } })` inutiles)

#### Migration UI

- [ ] **Intégrer le Basilic UI Kit**
  - Copier `app/components/ui/` (13 composants)
  - Créer `app/styles/ui-kit.css` (variables tokens)
  - Créer `app/styles/basilic-ui.css` (design system)
  - Importer les CSS dans `root.tsx`
  - Remplacer les composants Polaris page par page :
    1. `app._index.tsx` (page principale)
    2. `app.codes_promo.tsx`
    3. `app.clients.tsx`
    4. `app.analytique.tsx`
    5. `app.tutoriel.tsx`
    6. `app.tsx` (navigation)
  - Supprimer `@shopify/polaris` des dépendances une fois la migration complète

---

### V1 — Améliorations (futur)

- Recherche/filtre dans le tableau des partenaires
- Export CSV de la liste des pros
- Historique des commandes par partenaire (vue détail)
- Notifications (ex. alerte si un code promo est épuisé)
- Amélioration de la sécurité du mode édition (env var au lieu de hardcodé)

---

### V2 — Évolutions avancées (futur lointain)

- Dashboard analytics avancé (graphiques)
- Gestion des niveaux de partenariat (bronze/silver/gold)
- Système de parrainage entre pros
- API publique pour intégrations tierces

---

## 12. Règles de dev

### Général

- Un seul store : pas de logique multi-tenant dans le code métier
- Toujours tester les rollbacks (si création discount échoue → rollback)
- Ne jamais logger les tokens ou données sensibles
- Retourner toujours HTTP 200 dans les webhooks (même en cas d'erreur interne)

### Shopify API

- Version API : `October25` (GraphQL)
- Webhooks : `2026-01`
- Pagination GraphQL : max 250 items par requête
- Utiliser `nodes(ids: [...])` pour les bulk fetches (évite les N+1)

### TypeScript

- Strict mode activé
- Pas de `any` sauf cas exceptionnel documenté
- Les types GraphQL sont auto-générés via `graphql-codegen`

### CSS / UI

- Zéro Tailwind dans le projet final
- Zéro import Polaris une fois la migration terminée
- Convention BEM pour les classes custom : `ui-component`, `ui-component__element`, `ui-component--modifier`
- Variables CSS pour toutes les valeurs de design (couleurs, espacement, rayons)
