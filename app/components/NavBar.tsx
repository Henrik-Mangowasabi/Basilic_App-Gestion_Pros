// FICHIER : app/components/NavBar.tsx
import { NavLink, useNavigate, useLocation, useFetcher } from "react-router";
import { useRef, useEffect, useState } from "react";
import { useEditMode } from "../context/EditModeContext";

// --- ICONS ---
function IconAnalytics() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}

function IconProfessionals() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zm8 0a3 3 0 11-6 0 3 3 0 016 0zM10 10a5 5 0 00-5 5v1h10v-1a5 5 0 00-5-5z" />
    </svg>
  );
}

function IconPromo() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  );
}

function IconClients() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}


function IconLeaf() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 2-5 8z" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconValidation() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

function IconTutorial() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.396 0 2.695.37 3.809 1.016A4.5 4.5 0 0114.5 14c.967 0 1.876.27 2.647.741L18 15V4.804A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
    </svg>
  );
}

function IconUnlocked() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

// --- PASSWORD INPUT (focus via ref pour éviter autoFocus) ---
function PasswordInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref}
      type="password"
      placeholder="Code d'accès"
      value={value}
      className="sidebar-lock-input"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );
}

// --- COMPOSANT ---
export function NavBar() {
  const {
    isLocked,
    setIsLocked,
    showPass,
    setShowPass,
    password,
    setPassword,
    lockError,
    handleUnlock,
    showCodeBlock,
    setShowCodeBlock,
    showCABlock,
    setShowCABlock,
    config,
    setConfig,
    validationDefaults,
    setValidationDefaults,
    showToast,
  } = useEditMode();

  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher();
  const onAppPage = location.pathname === "/app";

  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [localThreshold, setLocalThreshold] = useState(config.threshold);
  const [localCreditAmount, setLocalCreditAmount] = useState(config.creditAmount);

  // Validation defaults
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [valDefaults, setValDefaults] = useState(validationDefaults);
  const [validationCount, setValidationCount] = useState(0);

  // Sync valDefaults quand le context est mis à jour par le serveur
  useEffect(() => {
    setValDefaults(validationDefaults);
  }, [validationDefaults.value, validationDefaults.type, validationDefaults.codePrefix]);

  useEffect(() => {
    const updateValidationCount = () => {
      try {
        const count = parseInt(localStorage.getItem("validation_pending_count") || "0", 10);
        setValidationCount(count);
      } catch {}
    };

    updateValidationCount();
    const interval = setInterval(updateValidationCount, 2000);
    return () => clearInterval(interval);
  }, []);

  const onAnalytiquePage = location.pathname === "/app/analytique";

  useEffect(() => {
    setLocalThreshold(config.threshold);
    setLocalCreditAmount(config.creditAmount);
  }, [config.threshold, config.creditAmount]);

  const handleSaveConfig = (e: { preventDefault: () => void }) => {
    e.preventDefault();

    // Mise à jour immédiate côté client pour feedback instantané
    setConfig({ threshold: localThreshold, creditAmount: localCreditAmount });
    setShowConfigPanel(false);

    // Sauvegarder côté serveur via fetcher (auth Shopify correcte)
    fetcher.submit(
      { action: "update_config", threshold: String(localThreshold), creditAmount: String(localCreditAmount) },
      { method: "POST", action: "/app" }
    );

    showToast({
      title: "Réglages sauvegardés",
      msg: `${localCreditAmount}€ tous les ${localThreshold}€ de CA.`,
      type: "success"
    });
  };

  const handleSaveValidationDefaults = (e: { preventDefault: () => void }) => {
    e.preventDefault();

    // Mise à jour immédiate côté client
    setValidationDefaults(valDefaults);
    setShowValidationPanel(false);

    // Sauvegarder côté serveur via fetcher (auth Shopify correcte)
    fetcher.submit(
      { action: "update_validation_defaults", value: String(valDefaults.value), type: valDefaults.type, codePrefix: valDefaults.codePrefix },
      { method: "POST", action: "/app" }
    );

    showToast({ title: "Paramètres sauvegardés", msg: `Valeur ${valDefaults.value}${valDefaults.type} • Code ${valDefaults.codePrefix}`, type: "success" });
  };

  const toggleConfigPanel = () => {
    setShowConfigPanel(!showConfigPanel);
    if (!showConfigPanel) setShowValidationPanel(false);
  };

  const toggleValidationPanel = () => {
    setShowValidationPanel(!showValidationPanel);
    if (!showValidationPanel) setShowConfigPanel(false);
  };

  const handleMouseLeave = () => {
    setShowConfigPanel(false);
    setShowValidationPanel(false);
  };

  const gestionItems = [
    {
      label: "Gestion Pros Santés",
      icon: <IconProfessionals />,
      isActive: onAppPage && !showCodeBlock && !showCABlock,
      onClick: () => { setShowCodeBlock(false); setShowCABlock(false); navigate("/app"); },
    },
    {
      label: "Gestion Code Promo",
      icon: <IconPromo />,
      isActive: onAppPage && showCodeBlock,
      onClick: () => { setShowCodeBlock(true); setShowCABlock(false); navigate("/app"); },
    },
    {
      label: "Gestion Chiffre d'affaires",
      icon: <IconClients />,
      isActive: onAppPage && showCABlock,
      onClick: () => { setShowCABlock(true); setShowCodeBlock(false); navigate("/app"); },
    },
  ];

  return (
    <aside className="sidebar" onMouseLeave={handleMouseLeave}>
      {/* LOGO */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <IconLeaf />
          </div>
          <span className="sidebar-logo-text">Basilic</span>
          <span className="sidebar-logo-badge">Free</span>
        </div>
      </div>

      {/* NAVIGATION */}
      <nav className="sidebar-nav">
        <NavLink
          to="/app/analytique"
          end={false}
          className={({ isActive }) =>
            ["sidebar-nav-item", isActive ? "sidebar-nav-item--active" : ""].filter(Boolean).join(" ")
          }
        >
          <span className="sidebar-nav-icon"><IconAnalytics /></span>
          <span className="sidebar-nav-label">Analytique</span>
          <span className="sidebar-nav-badge">NEW</span>
        </NavLink>

        {gestionItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className={["sidebar-nav-item", item.isActive ? "sidebar-nav-item--active" : ""].filter(Boolean).join(" ")}
            onClick={item.onClick}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-label">{item.label}</span>
          </button>
        ))}

        <NavLink
          to="/app/validation"
          end={false}
          className={({ isActive }) =>
            ["sidebar-nav-item", isActive ? "sidebar-nav-item--active" : ""].filter(Boolean).join(" ")
          }
        >
          <span className="sidebar-nav-icon"><IconValidation /></span>
          <span className="sidebar-nav-label">Validation Pros</span>
          {validationCount > 0 && <span className="sidebar-nav-badge">{validationCount}</span>}
        </NavLink>

        <NavLink
          to="/app/tutoriel"
          end={false}
          className={({ isActive }) =>
            ["sidebar-nav-item", isActive ? "sidebar-nav-item--active" : ""].filter(Boolean).join(" ")
          }
        >
          <span className="sidebar-nav-icon"><IconTutorial /></span>
          <span className="sidebar-nav-label">Tutoriel</span>
        </NavLink>
      </nav>

      {/* VERROU EDITION */}
      {!onAnalytiquePage && (
        <div className="sidebar-lock">
          {isLocked && !showPass && (
            <button
              type="button"
              className="sidebar-lock-btn sidebar-lock-btn--locked"
              onClick={() => setShowPass(true)}
              aria-label="Déverrouiller le mode édition"
            >
              <IconLock />
              Modifier
            </button>
          )}

          {showPass && (
            <div className="sidebar-lock-form">
              <PasswordInput
                value={password}
                onChange={setPassword}
                onEnter={handleUnlock}
              />
              <div className="sidebar-lock-form-actions">
                <button
                  type="button"
                  className="sidebar-lock-btn sidebar-lock-btn--confirm"
                  onClick={handleUnlock}
                  aria-label="Valider le mot de passe"
                >
                  Valider
                </button>
                <button
                  type="button"
                  className="sidebar-lock-btn sidebar-lock-btn--cancel"
                  onClick={() => { setShowPass(false); setPassword(""); }}
                  aria-label="Annuler"
                >
                  ✕
                </button>
              </div>
              {lockError && (
                <span className="sidebar-lock-error">{lockError}</span>
              )}
            </div>
          )}

          {!isLocked && (
            <button
              type="button"
              className="sidebar-lock-btn sidebar-lock-btn--unlocked"
              onClick={() => setIsLocked(true)}
              aria-label="Verrouiller le mode édition"
            >
              <IconUnlocked />
              Mode édition activé
            </button>
          )}
        </div>
      )}

      {/* RÉGLAGES CRÉDITS */}
      {!onAnalytiquePage && (
        <div className="sidebar-settings">
          <button
            type="button"
            className={`sidebar-lock-btn${isLocked ? " sidebar-lock-btn--settings-locked" : " sidebar-lock-btn--settings"}`}
            disabled={isLocked}
            onClick={toggleConfigPanel}
            aria-expanded={showConfigPanel}
            aria-controls="sidebar-config-panel"
          >
            <IconGear />
            Réglages Crédits
          </button>
          <span className="sidebar-settings-info">
            {config.creditAmount}€ tous les {config.threshold}€ de CA généré
          </span>

          {showConfigPanel && !isLocked && (
            <form id="sidebar-config-panel" onSubmit={handleSaveConfig} className="sidebar-settings-form">
              <div className="sidebar-settings-row">
                <div className="sidebar-settings-field">
                  <label htmlFor="sb-threshold" className="sidebar-settings-label">Seuil (€)</label>
                  <input
                    id="sb-threshold"
                    type="number"
                    value={localThreshold}
                    onChange={(e) => setLocalThreshold(parseFloat(e.target.value) || 0)}
                    step="0.01"
                    className="sidebar-lock-input"
                  />
                </div>
                <div className="sidebar-settings-field">
                  <label htmlFor="sb-credit" className="sidebar-settings-label">Montant (€)</label>
                  <input
                    id="sb-credit"
                    type="number"
                    value={localCreditAmount}
                    onChange={(e) => setLocalCreditAmount(parseFloat(e.target.value) || 0)}
                    step="0.01"
                    className="sidebar-lock-input"
                  />
                </div>
              </div>
              <div className="sidebar-lock-form-actions">
                <button type="submit" className="sidebar-lock-btn sidebar-lock-btn--confirm">
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="sidebar-lock-btn sidebar-lock-btn--cancel"
                  onClick={() => setShowConfigPanel(false)}
                >
                  ✕
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* PARAMÈTRES VALIDATION */}
      {!onAnalytiquePage && (
        <div className="sidebar-settings">
          <button
            type="button"
            className={`sidebar-lock-btn${isLocked ? " sidebar-lock-btn--settings-locked" : " sidebar-lock-btn--settings"}`}
            disabled={isLocked}
            onClick={toggleValidationPanel}
            aria-expanded={showValidationPanel}
            aria-controls="sidebar-validation-panel"
          >
            <IconGear />
            Réglages Code
          </button>
          <span className="sidebar-settings-info">
            Valeur {valDefaults.value}{valDefaults.type} • Code {valDefaults.codePrefix}
          </span>

          {showValidationPanel && !isLocked && (
            <form id="sidebar-validation-panel" onSubmit={handleSaveValidationDefaults} className="sidebar-settings-form">
              <div className="sidebar-settings-row">
                <div className="sidebar-settings-field sidebar-settings-field--small">
                  <label htmlFor="val-value" className="sidebar-settings-label">Valeur</label>
                  <input
                    id="val-value"
                    type="number"
                    value={valDefaults.value}
                    onChange={(e) => setValDefaults({ ...valDefaults, value: parseFloat(e.target.value) || 0 })}
                    step="0.01"
                    className="sidebar-lock-input"
                  />
                </div>
                <div className="sidebar-settings-field sidebar-settings-field--small">
                  <label htmlFor="val-type" className="sidebar-settings-label">Type</label>
                  <select
                    id="val-type"
                    value={valDefaults.type}
                    onChange={(e) => setValDefaults({ ...valDefaults, type: e.target.value })}
                    className="sidebar-lock-input"
                  >
                    <option value="%">%</option>
                    <option value="€">€</option>
                  </select>
                </div>
                <div className="sidebar-settings-field sidebar-settings-field--large">
                  <label htmlFor="val-prefix" className="sidebar-settings-label">Préfixe</label>
                  <input
                    id="val-prefix"
                    type="text"
                    value={valDefaults.codePrefix}
                    onChange={(e) => setValDefaults({ ...valDefaults, codePrefix: e.target.value })}
                    className="sidebar-lock-input"
                  />
                </div>
              </div>
              <div className="sidebar-lock-form-actions">
                <button type="submit" className="sidebar-lock-btn sidebar-lock-btn--confirm">
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="sidebar-lock-btn sidebar-lock-btn--cancel"
                  onClick={() => setShowValidationPanel(false)}
                >
                  ✕
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* FOOTER */}
      <div className="sidebar-footer">
        <span className="sidebar-footer-text">By Moon Moon</span>
      </div>
    </aside>
  );
}
