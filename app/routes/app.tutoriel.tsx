// FICHIER : app/routes/app.tutoriel.tsx
import type { ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, redirect, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { checkMetaobjectStatus, destroyMetaobjectStructure } from "../lib/metaobject.server";
import { useEditMode } from "../context/EditModeContext";
import { useState, useRef, useEffect } from "react";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "destroy_structure") {
    const result = await destroyMetaobjectStructure(admin);
    if (result.success) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return redirect("/app?success=structure_deleted");
    }
    return { error: result.error || "Erreur suppression totale" };
  }

  return null;
};

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);
  return { isInitialized: status.exists };
};

const Spinner = ({ color = "white", size = "16px" }: { color?: string; size?: string }) => (
  <div style={{ width: size, height: size, border: `2px solid rgba(0,0,0,0.1)`, borderTop: `2px solid ${color}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }}>
    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
  </div>
);

function DangerModal({ onClose, isLocked }: { onClose: () => void; isLocked: boolean }) {
  const nav = useNavigation();
  const isDestroying = nav.formData?.get("action") === "destroy_structure";
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText === "SUPPRIMER" && !isLocked;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;
    const sel = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(sel));
    focusable[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tuto-modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="tuto-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Zone Danger">
        <div className="tuto-modal__header">
          <span className="tuto-modal__title">⚠️ Zone Danger</span>
          <button type="button" className="tuto-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="tuto-modal__body">
          <div className="tuto-danger-warning">
            <p><strong>Cette action est irréversible.</strong> Elle va supprimer :</p>
            <ul>
              <li>Tous les professionnels de santé enregistrés</li>
              <li>Tous les codes promo liés</li>
              <li>Les tags pro sur tous les clients Shopify</li>
              <li>La structure complète de l&apos;application</li>
            </ul>
            {isLocked && (
              <p className="tuto-danger-locked">🔒 Déverrouillez le mode édition pour accéder à cette action.</p>
            )}
          </div>
          {!isLocked && (
            <div className="tuto-danger-confirm">
              <label className="tuto-danger-label">
                Pour confirmer, tapez <strong>SUPPRIMER</strong> ci-dessous :
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="tuto-danger-input"
                placeholder="SUPPRIMER"
                autoComplete="off"
              />
              <Form method="post">
                <input type="hidden" name="action" value="destroy_structure" />
                <button
                  type="submit"
                  disabled={!canDelete || isDestroying}
                  className={`tuto-danger-btn${canDelete && !isDestroying ? " tuto-danger-btn--active" : ""}`}
                >
                  {isDestroying ? (
                    <><Spinner /> Suppression en cours...</>
                  ) : (
                    "☢️ TOUT SUPPRIMER & RÉINITIALISER"
                  )}
                </button>
              </Form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TutorielPage() {
  const { isInitialized } = useLoaderData<typeof loader>();
  const { isLocked } = useEditMode();
  const [showDangerModal, setShowDangerModal] = useState(false);

  return (
    <div className="page-wrapper">

      {/* HEADER */}
      <div className="page-header">
        <h1 className="page-header__title">Tutoriel</h1>
        <div className="page-header__actions">
          <button
            type="button"
            className="tuto-danger-zone-btn"
            onClick={() => setShowDangerModal(true)}
          >
            ⚠️ Zone Danger
          </button>
        </div>
      </div>

      {/* MODAL DANGER */}
      {showDangerModal && (
        <DangerModal onClose={() => setShowDangerModal(false)} isLocked={isLocked} />
      )}

      {/* STATUT APP */}
      <div className={`tuto-status-banner${isInitialized ? " tuto-status-banner--ok" : " tuto-status-banner--warn"}`}>
        {isInitialized
          ? "✅ Application initialisée — Tous les systèmes sont opérationnels."
          : "⚠️ Application non initialisée — Rendez-vous sur la page principale pour démarrer la configuration."}
      </div>

      {/* CONTENU */}
      <div className="tuto-content">

        {/* ── SECTION 1 : PRÉSENTATION ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">🌿</span>
            Bienvenue sur Basilic App
          </h2>
          <p className="tuto-section__desc">
            Basilic App est une application Shopify conçue pour gérer vos <strong>partenaires professionnels de santé</strong>.
            Elle vous permet de créer et distribuer des codes promo personnalisés, de suivre leur chiffre d&apos;affaires,
            et d&apos;attribuer automatiquement des crédits boutique en récompense de leurs ventes.
          </p>
          <div className="tuto-cards-row">
            <div className="tuto-card tuto-card--green">
              <div className="tuto-card__icon">👥</div>
              <div className="tuto-card__label">Pros enregistrés</div>
              <div className="tuto-card__desc">Gérez vos partenaires avec leurs informations complètes</div>
            </div>
            <div className="tuto-card tuto-card--blue">
              <div className="tuto-card__icon">🎟️</div>
              <div className="tuto-card__label">Codes promo</div>
              <div className="tuto-card__desc">Créez et activez/désactivez les codes depuis l&apos;app</div>
            </div>
            <div className="tuto-card tuto-card--orange">
              <div className="tuto-card__icon">💰</div>
              <div className="tuto-card__label">Crédits automatiques</div>
              <div className="tuto-card__desc">Récompensez vos pros dès qu&apos;un seuil de CA est atteint</div>
            </div>
            <div className="tuto-card tuto-card--purple">
              <div className="tuto-card__icon">📊</div>
              <div className="tuto-card__label">Analytique</div>
              <div className="tuto-card__desc">Visualisez les performances de chaque partenaire</div>
            </div>
          </div>
        </div>

        {/* ── SECTION 2 : NAVIGATION ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">🗺️</span>
            Navigation — Le menu latéral
          </h2>
          <p className="tuto-section__desc">
            Toutes les sections de l&apos;application sont accessibles depuis la barre de navigation sur la gauche de l&apos;écran.
          </p>
          <div className="tuto-nav-list">
            <div className="tuto-nav-item">
              <span className="tuto-nav-item__badge tuto-nav-item__badge--new">NEW</span>
              <strong>Analytique</strong> — Tableau de bord avec statistiques globales et classement des pros les plus performants.
            </div>
            <div className="tuto-nav-item">
              <strong>Gestion Pros Santés</strong> — Liste complète de vos partenaires avec leurs informations et actions disponibles.
            </div>
            <div className="tuto-nav-item">
              <strong>Gestion Code Promo</strong> — Vue dédiée pour activer ou désactiver chaque code promo individuellement.
            </div>
            <div className="tuto-nav-item">
              <strong>Gestion Chiffre d&apos;affaires</strong> — Suivi du CA généré par chaque pro et gestion des crédits associés.
            </div>
            <div className="tuto-nav-item">
              <strong>Tutoriel</strong> — Cette page que vous consultez en ce moment.
            </div>
          </div>
        </div>

        {/* ── SECTION 3 : MODE EDITION ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">🔒</span>
            Mode Édition — Protection des données
          </h2>
          <p className="tuto-section__desc">
            Pour éviter toute modification accidentelle, l&apos;application dispose d&apos;un système de <strong>verrouillage par mot de passe</strong>.
          </p>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div>Cliquez sur le bouton <strong>Modifier</strong> en bas du menu latéral gauche.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div>Saisissez le code d&apos;accès fourni par votre administrateur.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">3</div>
              <div>Le bouton passe en vert <strong>Mode édition activé</strong> — vous pouvez maintenant créer, modifier et supprimer des pros.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">4</div>
              <div>Cliquez sur ce bouton à nouveau pour <strong>reverrouiller</strong> et protéger les données.</div>
            </div>
          </div>
          <div className="tuto-info-box">
            💡 <strong>Conseil :</strong> Veillez à reverrouiller l&apos;app après chaque session de modification pour protéger vos données.
          </div>
        </div>

        {/* ── SECTION 4 : GESTION PROS ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">👥</span>
            Gestion des Professionnels de Santé
          </h2>
          <p className="tuto-section__desc">
            C&apos;est la page principale de l&apos;application. Elle contient la liste de tous vos partenaires
            avec leurs informations complètes.
          </p>

          <h3 className="tuto-subsection">Ajouter un professionnel</h3>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div>Cliquez sur <strong>+ Nouveau partenaire</strong> en haut de la liste — aucun mot de passe requis.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div>Remplissez les champs : <strong>Prénom</strong>, <strong>Nom</strong>, <strong>Email</strong>, <strong>Code promo</strong>, <strong>Montant</strong>, <strong>Type</strong> (% ou €). Profession et adresse sont optionnels.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">3</div>
              <div>Cliquez sur <strong>Créer</strong>. L&apos;app crée automatiquement le code promo dans Shopify et associe le client.</div>
            </div>
          </div>

          <h3 className="tuto-subsection">Modifier un professionnel</h3>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div>Cliquez sur le bouton <strong>...</strong> sur la ligne du professionnel, puis sélectionnez <strong>Éditer</strong>.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div>Modifiez les informations souhaitées et cliquez sur <strong>Enregistrer</strong>. Les informations du client Shopify sont automatiquement synchronisées.</div>
            </div>
          </div>

          <h3 className="tuto-subsection">Supprimer un professionnel</h3>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div><strong>Déverrouillez le mode édition</strong> (obligatoire pour supprimer).</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div><strong>Option A</strong> — Cliquez sur <strong>...</strong> sur la ligne du professionnel, puis <strong>Supprimer</strong>.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">3</div>
              <div><strong>Option B</strong> — Cochez la case de sélection à gauche de la ligne (ou plusieurs lignes), puis cliquez sur <strong>Supprimer la sélection</strong>.</div>
            </div>
          </div>
          <div className="tuto-info-box tuto-info-box--warning">
            ⚠️ La suppression efface définitivement le professionnel, désactive et supprime son code promo, et retire le tag « Pro » de sa fiche client Shopify.
          </div>

        </div>

        {/* ── SECTION 5 : IMPORT ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">📥</span>
            Import en masse — Excel &amp; CSV
          </h2>
          <p className="tuto-section__desc">
            Vous pouvez ajouter plusieurs professionnels d&apos;un coup en important un fichier Excel (.xlsx, .xls) ou CSV.
          </p>

          <h3 className="tuto-subsection">Format du fichier</h3>
          <div className="tuto-cols-simple">
            <span className="tuto-col--required">Prénom *</span>
            <span className="tuto-col--required">Nom *</span>
            <span className="tuto-col--required">Email *</span>
            <span className="tuto-col--required">Code *</span>
            <span className="tuto-col--required">Montant *</span>
            <span className="tuto-col--required">Type *</span>
            <span className="tuto-col--optional">Profession</span>
            <span className="tuto-col--optional">Adresse</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--color-gray-500)", marginTop: "8px" }}>
            <span style={{ color: "#d82c0d" }}>*</span> champs obligatoires
          </p>

          <h3 className="tuto-subsection">Comment importer</h3>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div>Cliquez sur le bouton <strong>Importer</strong> en haut de la page Gestion Pros Santés.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div>Cliquez sur <strong>Choisir un fichier</strong> et sélectionnez votre fichier Excel ou CSV.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">3</div>
              <div>Vérifiez le nombre de lignes détectées, puis cliquez sur <strong>Importer</strong>.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">4</div>
              <div>Un rapport s&apos;affiche : lignes importées, doublons ignorés, erreurs éventuelles.</div>
            </div>
          </div>
          <div className="tuto-info-box tuto-info-box--warning">
            ⚠️ <strong>Doublons :</strong> Si un code promo ou une référence existe déjà, la ligne est ignorée (pas de duplication).
          </div>
        </div>

        {/* ── SECTION 6 : CODES PROMO ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">🎟️</span>
            Gestion des Codes Promo
          </h2>
          <p className="tuto-section__desc">
            La page <strong>Gestion Code Promo</strong> affiche tous les codes promo liés à vos partenaires.
            Vous pouvez les activer ou désactiver sans toucher à la fiche du professionnel.
          </p>
          <div className="tuto-feature-list">
            <div className="tuto-feature">
              <span className="tuto-feature__icon">🟢</span>
              <div><strong>Activer un code</strong> — Déverrouillez le mode édition, puis cliquez sur le toggle pour activer le code. Il sera utilisable dans la boutique.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">⚫</span>
              <div><strong>Désactiver un code</strong> — Déverrouillez le mode édition, puis cliquez sur le toggle pour le passer en inactif. Le code ne sera plus utilisable sans être supprimé.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">🔗</span>
              <div><strong>Bouton LIEN</strong> — Ouvre directement la page du code promo dans votre administration Shopify pour plus de détails.</div>
            </div>
          </div>
          <div className="tuto-info-box">
            💡 Utilisez la bascule <strong>Code Promo / Chiffre d&apos;affaires</strong> en haut de la page principale pour naviguer entre les deux vues sans changer de page.
          </div>
        </div>

        {/* ── SECTION 7 : CHIFFRE D'AFFAIRES ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">💰</span>
            Gestion du Chiffre d&apos;affaires &amp; Crédits
          </h2>
          <p className="tuto-section__desc">
            Cette vue vous donne une vision financière par partenaire : combien ils ont généré, et combien de crédits boutique ils ont accumulés.
          </p>
          <div className="tuto-feature-list">
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📦</span>
              <div><strong>Commandes</strong> — Nombre total de commandes passées avec le code promo du partenaire.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">💵</span>
              <div><strong>CA Total</strong> — Chiffre d&apos;affaires total généré par le partenaire depuis le début.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">🎁</span>
              <div><strong>Crédits gagnés</strong> — Calculé automatiquement selon les réglages : ex. 10 € de crédit tous les 500 € de CA.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">✅</span>
              <div><strong>Crédits restants</strong> — Solde actuel de Store Credit Shopify disponible pour le partenaire.</div>
            </div>
          </div>
          <div className="tuto-info-box">
            💡 Utilisez la bascule <strong>Code Promo / Chiffre d&apos;affaires</strong> en haut de la page principale pour naviguer entre les deux vues sans changer de page.
          </div>
        </div>

        {/* ── SECTION 8 : RÉGLAGES CRÉDITS ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">⚙️</span>
            Réglages Crédits — Configuration automatique
          </h2>
          <p className="tuto-section__desc">
            Configurez la règle de récompense automatique : quand un partenaire atteint un seuil de CA, il reçoit un crédit boutique.
          </p>
          <div className="tuto-steps">
            <div className="tuto-step">
              <div className="tuto-step__num">1</div>
              <div>Déverrouillez le mode édition.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">2</div>
              <div>Cliquez sur <strong>Réglages Crédits</strong> en bas du menu latéral.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">3</div>
              <div>Définissez le <strong>Seuil (€)</strong> — montant de CA à atteindre pour déclencher un crédit. Ex : <em>500 €</em>.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">4</div>
              <div>Définissez le <strong>Montant (€)</strong> — valeur du crédit offert. Ex : <em>10 €</em>.</div>
            </div>
            <div className="tuto-step">
              <div className="tuto-step__num">5</div>
              <div>Cliquez sur <strong>Enregistrer</strong>. Les réglages sont sauvegardés et s&apos;appliquent immédiatement aux prochaines commandes.</div>
            </div>
          </div>
          <div className="tuto-info-box">
            💡 <strong>Exemple :</strong> Avec un seuil de 500 € et un crédit de 10 €, un partenaire qui génère 1 500 € de CA aura accumulé 30 € de crédits boutique.
          </div>
        </div>

        {/* ── SECTION 9 : ANALYTIQUE ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">📊</span>
            Analytique — Tableau de bord
          </h2>
          <p className="tuto-section__desc">
            La page Analytique vous donne une vue d&apos;ensemble des performances de votre programme partenaires.
            C&apos;est votre tableau de bord pour piloter l&apos;activité de vos pros en un coup d&apos;œil.
          </p>

          <h3 className="tuto-subsection">Indicateurs clés (KPIs)</h3>
          <div className="tuto-feature-list">
            <div className="tuto-feature">
              <span className="tuto-feature__icon">🛒</span>
              <div><strong>Total commandes</strong> — Nombre total de commandes passées avec un code promo pro sur la période sélectionnée.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">💵</span>
              <div><strong>CA total</strong> — Chiffre d&apos;affaires cumulé généré par l&apos;ensemble de vos partenaires sur la période.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">✅</span>
              <div><strong>Pros actifs</strong> — Nombre de partenaires ayant généré au moins une commande sur la période.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">👥</span>
              <div><strong>Pros enregistrés</strong> — Nombre total de partenaires dans votre base, indépendamment de leur activité.</div>
            </div>
          </div>

          <h3 className="tuto-subsection">Filtre par période</h3>
          <p className="tuto-section__desc">
            En haut de la page, sélectionnez la période d&apos;analyse pour affiner tous les indicateurs et le classement :
          </p>
          <div className="tuto-feature-list">
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📅</span>
              <div><strong>Cette semaine</strong> — Commandes et CA des 7 derniers jours.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📅</span>
              <div><strong>Ce mois</strong> — Commandes et CA du mois en cours.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📅</span>
              <div><strong>Ce trimestre</strong> — Commandes et CA des 3 derniers mois.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📅</span>
              <div><strong>Depuis le début</strong> — Toutes les données depuis l&apos;installation de l&apos;application.</div>
            </div>
          </div>

          <h3 className="tuto-subsection">Filtre par profession</h3>
          <p className="tuto-section__desc">
            Filtrez le classement par type de profession pour comparer uniquement les partenaires d&apos;une même catégorie :
            kinésithérapeutes, ostéopathes, médecins, sages-femmes, etc.
            Sélectionnez <strong>Toutes</strong> pour revenir à la vue globale.
          </p>

          <h3 className="tuto-subsection">Classement des pros</h3>
          <div className="tuto-feature-list">
            <div className="tuto-feature">
              <span className="tuto-feature__icon">🏆</span>
              <div><strong>Top performers</strong> — Le classement affiche vos partenaires triés par CA décroissant. Le premier est celui qui génère le plus de ventes.</div>
            </div>
            <div className="tuto-feature">
              <span className="tuto-feature__icon">📊</span>
              <div><strong>Barre de progression</strong> — Chaque partenaire dispose d&apos;une barre visuelle représentant sa part du CA total, pour identifier rapidement les plus performants.</div>
            </div>
          </div>
          <div className="tuto-info-box">
            💡 Combinez le filtre par <strong>période</strong> et par <strong>profession</strong> pour des analyses précises : ex. « Qui sont mes meilleurs kiné ce mois-ci ? »
          </div>
        </div>

        {/* ── SECTION 10 : FAQ ── */}
        <div className="tuto-section">
          <h2 className="tuto-section__title">
            <span className="tuto-section__icon">❓</span>
            Questions fréquentes
          </h2>
          <div className="tuto-faq-list">
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Que se passe-t-il si je supprime un pro ?</summary>
              <div className="tuto-faq__answer">
                Le professionnel est retiré de l&apos;application, son code promo est désactivé et supprimé dans Shopify,
                et le tag &quot;Pro&quot; est retiré de sa fiche client. Ses commandes passées ne sont pas affectées.
              </div>
            </details>
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Un pro peut-il utiliser son code promo plusieurs fois ?</summary>
              <div className="tuto-faq__answer">
                Oui, les codes promo créés par l&apos;app sont configurés avec un usage illimité par défaut.
                Vous pouvez modifier cette limite directement dans l&apos;administration Shopify via le bouton LIEN.
              </div>
            </details>
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Les crédits sont-ils attribués automatiquement ?</summary>
              <div className="tuto-faq__answer">
                Oui. À chaque nouvelle commande Shopify utilisant le code d&apos;un partenaire, l&apos;application calcule
                si le seuil est atteint et ajoute automatiquement les crédits sur le compte du partenaire.
              </div>
            </details>
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Mon fichier Excel n&apos;est pas importé correctement, que faire ?</summary>
              <div className="tuto-faq__answer">
                Vérifiez que votre fichier respecte bien les colonnes obligatoires : <strong>Prénom, Nom, Email, Code, Montant, Type</strong>.
                Les noms des colonnes doivent être exacts (1ère ligne = en-têtes). Évitez les cellules fusionnées.
              </div>
            </details>
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Peut-on avoir deux pros avec le même code promo ?</summary>
              <div className="tuto-faq__answer">
                Non. Chaque code promo doit être unique. Si vous tentez d&apos;importer un code déjà existant,
                la ligne sera ignorée et signalée comme doublon dans le rapport d&apos;import.
              </div>
            </details>
            <details className="tuto-faq">
              <summary className="tuto-faq__question">Comment modifier les réglages crédits sans perdre les données ?</summary>
              <div className="tuto-faq__answer">
                Les réglages crédits ne modifient pas les crédits déjà attribués. Seules les prochaines commandes
                seront calculées avec les nouveaux paramètres.
              </div>
            </details>
          </div>
        </div>

        {/* FOOTER */}
        <div className="tuto-footer">
          <span>Basilic App — By Moon Moon</span>
          <span>Support : contactez votre administrateur pour toute question technique.</span>
        </div>

      </div>
    </div>
  );
}
