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
| @shopify/polaris | 13.9.5 | UI actuelle (à remplacer par Basilic UI Kit) |
| Prisma | 6.16.3 | ORM |
| PostgreSQL (Supabase) | — | Base de données |
| XLSX | 0.18.5 | Parsing Excel/CSV |

---

## 3. Architecture fichiers

```
mm-gestion-pros-sante/
├── app/
│   ├── routes/
│   │   ├── app.tsx                    # Layout root + navigation
│   │   ├── app._index.tsx             # Page principale — Gestion des pros (~2250 lignes)
│   │   ├── app.codes_promo.tsx        # Page codes promo
│   │   ├── app.clients.tsx            # Page clients / store credit
│   │   ├── app.analytique.tsx         # Page analytique
│   │   ├── app.tutoriel.tsx           # Guide d'utilisation
│   │   ├── app.api.import.tsx         # Endpoint API import externe
│   │   ├── webhooks.orders.create.tsx # Webhook commandes (~500 lignes)
│   │   └── webhooks.app.uninstalled.tsx
│   ├── lib/
│   │   ├── metaobject.server.ts       # CRUD métaobjets Shopify (~507 lignes)
│   │   ├── discount.server.ts         # Gestion codes promo Shopify (~165 lignes)
│   │   ├── customer.server.ts         # Gestion clients Shopify (~300 lignes)
│   │   └── logger.server.ts           # Logger
│   ├── components/
│   │   ├── Pagination.tsx             # Composant pagination
│   │   └── ErrorDisplay.tsx           # Affichage erreurs
│   ├── db.server.ts                   # Singleton Prisma
│   ├── shopify.server.ts              # Init Shopify API
│   └── root.tsx                       # Layout HTML racine
├── prisma/
│   └── schema.prisma                  # Schéma BDD (Session + Config)
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

#### Réglages Crédits Store
- Seuil de CA (ex. 500 €) pour déclencher 1 crédit
- Montant du crédit offert (ex. 10 €)
- Stocké en base (modèle `Config`)

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

### 4.3 Gestion Clients Pros (`/app/clients`)

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
| Nom | `name` | single_line_text | ✓ |
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

> **Modification prévue (V0)** : Séparer `name` en `first_name` + `last_name` dans le métaobjet.

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

### Règle de calcul

```
crédits_gagnés = floor(CA_total / seuil) × montant_crédit
```

Exemple avec seuil=500€ et crédit=10€ :
- CA 400€ → 0€ crédit
- CA 500€ → 10€ crédit
- CA 1 000€ → 20€ crédit

### Déclenchement

À chaque commande (webhook `orders/create`) :
1. Extraction du code promo utilisé
2. Recherche du pro associé (via le métaobjet)
3. Calcul du nouveau CA (avant remise)
4. Mise à jour des caches dans le métaobjet
5. Calcul du delta crédit à créditer
6. Crédit du compte Store Credit Shopify du client (si delta > 0)
7. Mise à jour du metafield `ca_genere` sur la fiche client (**à ajouter V0**)

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

### `orders/create`

Déclenché à chaque nouvelle commande.

Étapes :
1. Extraction du code promo (3 méthodes en fallback)
2. Calcul CA (montant avant remise, 4 méthodes en fallback)
3. Recherche du pro par code (indexée puis exhaustive)
4. Mise à jour cache métaobjet
5. Crédit Store Credit client (si delta > 0)
6. Toujours retourner HTTP 200 (évite les re-tentatives Shopify)

### `app/uninstalled`

Nettoyage de la session en base lors de la désinstallation.

---

## 9. Base de données

### Modèle `Session` (Prisma)

Gère les sessions OAuth Shopify. **Conservé tel quel** (requis par le framework).

### Modèle `Config`

```prisma
model Config {
  id           Int    @id @default(autoincrement())
  shop         String @unique
  threshold    Float  @default(500.0)   // Seuil CA (€)
  creditAmount Float  @default(10.0)    // Crédit offert (€)
}
```

> **Simplification V0** : La logique multi-store sera supprimée. La DB ne sert qu'à stocker la session et la config du store unique. Le champ `shop` reste pour la compatibilité avec le framework Shopify.

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
