// FICHIER : app/routes/app.codes_promo.tsx
import { useLoaderData, Link, useFetcher } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import React, { useState } from "react";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, updateMetaobjectEntry, checkMetaobjectStatus } from "../lib/metaobject.server";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  
  // VÉRIFICATION INITIALISATION
  const status = await checkMetaobjectStatus(admin);
  if (!status.exists) return { entries: [], isInitialized: false };

  const { entries } = await getMetaobjectEntries(admin);

  // --- LOGIQUE AJOUTÉE : RÉCUPÉRATION DES VRAIS NOMS CLIENTS ---
  // 1. Récupérer les ID clients liés
  const customerIds = entries
    .map((e: any) => e.customer_id)
    .filter((id: string) => id && id.startsWith("gid://shopify/Customer/"));

  // 2. Faire une requête groupée pour avoir les noms (Optimisation Perf)
  const nameMap = new Map<string, string>();
  
  if (customerIds.length > 0) {
    const query = `#graphql
      query getCustomerNames($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            firstName
            lastName
          }
        }
      }
    `;
    try {
        const response = await admin.graphql(query, { variables: { ids: customerIds } });
        const data = await response.json();
        const nodes = data.data?.nodes || [];
        nodes.forEach((node: any) => {
            if (node) {
               // On stocke "Prénom Nom"
               nameMap.set(node.id, `${node.firstName} ${node.lastName}`);
            }
        });
    } catch (e) {
        console.error("Erreur récupération noms clients", e);
    }
  }

  // 3. Remplacer le nom interne par le vrai nom client (si trouvé)
  const enrichedEntries = entries.map((entry: any) => ({
      ...entry,
      // Si on a trouvé le client Shopify, on affiche son Prénom/Nom. 
      // Sinon on garde le nom interne du métaobjet (fallback).
      displayName: nameMap.get(entry.customer_id) || entry.name
  }));

  return { entries: enrichedEntries, isInitialized: true };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const actionType = formData.get("action");
  const id = formData.get("id") as string;

  if (actionType === "toggle_status") {
    const newStatus = formData.get("new_status") === "true"; 
    // Note: updateMetaobjectEntry gère maintenant le toggleShopifyDiscount en interne (via tes updates précédents)
    const result = await updateMetaobjectEntry(admin, id, { status: newStatus });
    return result.success ? { success: true } : { success: false, error: result.error };
  }
  return null;
};

const Spinner = ({ color = "white", size = "14px" }) => (
  <div style={{
    width: size, height: size,
    border: `2px solid rgba(0,0,0,0.1)`,
    borderTop: `2px solid ${color}`,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    display: "inline-block",
    verticalAlign: "middle"
  }}>
    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
  </div>
);

// Helper ID propre
const extractId = (gid: string) => gid ? gid.split("/").pop() : "";

export default function CodesPromoPage() {
  const { entries, isInitialized } = useLoaderData<typeof loader>();
  
  // SI NON INITIALISÉ
  if (!isInitialized) {
      return (
        <div style={{ width: "100%", height: "80vh", display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#f6f6f7" }}>
            <div style={{ backgroundColor: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", maxWidth: "500px", textAlign: "center" }}>
                <h2 style={{ fontSize: "1.2rem", marginBottom: "15px", color: "#d82c0d" }}>Application non initialisée</h2>
                <p style={{ color: "#666", marginBottom: "30px" }}>Veuillez vous rendre sur la page principale pour configurer l'application.</p>
                <Link to="/app" style={{ textDecoration: "none", padding: "12px 24px", backgroundColor: "#008060", color: "white", borderRadius: "8px", fontWeight: "600" }}>
                    Aller sur la page principale
                </Link>
            </div>
        </div>
      );
  }

  const fetcher = useFetcher();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const totalPages = Math.ceil(entries.length / itemsPerPage);
  const currentEntries = entries.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const styles = {
    wrapper: { width: "100%", padding: "20px", backgroundColor: "#f6f6f7", fontFamily: "-apple-system, sans-serif", boxSizing: "border-box" as const },
    navButton: { textDecoration: "none", color: "#008060", fontWeight: "600", backgroundColor: "white", border: "1px solid #c9cccf", padding: "8px 16px", borderRadius: "4px", fontSize: "0.9rem", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s ease" },
    infoDetails: { marginBottom: "20px", backgroundColor: "white", borderRadius: "8px", border: "1px solid #e1e3e5", borderLeft: "4px solid #008060", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflow: "hidden" },
    infoSummary: { padding: "12px 20px", cursor: "pointer", fontWeight: "600", color: "#444", outline: "none", listStyle: "none" },
    
    // PADDING UNIFIÉ : 16px 12px
    cell: { padding: "16px 12px", fontSize: "0.9rem", verticalAlign: "middle", borderBottom: "1px solid #eee" },
    cellCenter: { padding: "16px 12px", fontSize: "0.9rem", verticalAlign: "middle", borderBottom: "1px solid #eee", textAlign: "center" as const },
    cellPromo: { padding: "16px 12px", fontSize: "0.9rem", verticalAlign: "middle", borderBottom: "1px solid #e1e3e5", textAlign: "center" as const },
    cellFit: { width: "1%", whiteSpace: "nowrap" as const, padding: "16px 20px", fontSize: "0.9rem", verticalAlign: "middle", borderBottom: "1px solid #e1e3e5", textAlign: "center" as const },
    
    badgeCode: { backgroundColor: "#e3f1df", color: "#008060", padding: "4px 8px", borderRadius: "4px", fontFamily: "monospace", fontWeight: "bold", fontSize: "0.9rem" },
    adminBtn: { fontSize: "0.75rem", color: "#005bd3", textDecoration: "none", border: "1px solid #b8d0eb", padding: "4px 8px", borderRadius: "4px", backgroundColor: "#f0f8ff", fontWeight: "600" },

    paginationContainer: { display: "flex", justifyContent: "center", alignItems: "center", padding: "15px", gap: "15px", backgroundColor: "white", borderTop: "1px solid #eee" },
    pageBtn: { padding: "6px 12px", border: "1px solid #ccc", backgroundColor: "white", borderRadius: "4px", cursor: "pointer", color: "#333", fontWeight: "500", fontSize: "0.9rem" },
    pageBtnDisabled: { padding: "6px 12px", border: "1px solid #eee", backgroundColor: "#f9fafb", borderRadius: "4px", cursor: "not-allowed", color: "#ccc", fontWeight: "500", fontSize: "0.9rem" }
  };

  const containerMaxWidth = "1600px";

  const thStyle = { padding: "12px 10px", textAlign: "left" as const, fontSize: "0.8rem", textTransform: "uppercase" as const, color: "#888" };
  const thCenter = { ...thStyle, textAlign: "center" as const };
  const thPromoStyle = { ...thStyle, textAlign: "center" as const, backgroundColor: "#f1f8f5", color: "#008060", borderBottom: "2px solid #e1e3e5" };
  const thPromoBorder = { borderLeft: "2px solid #e1e3e5" };
  const thActionStyle = { ...thStyle, textAlign: "center" as const, borderLeft: "2px solid #eee" };

  return (
    <div style={styles.wrapper}>
      <style>{`.nav-btn:hover { background-color: #f1f8f5 !important; border-color: #008060 !important; box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important; }`}</style>

      <h1 style={{ color: "#202223", marginBottom: "20px", textAlign: "center", fontSize: "1.8rem", fontWeight: "700" }}>
        Gestion des Codes Promo
      </h1>

      <div style={{ display: "flex", justifyContent: "center", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link to="/app" className="nav-btn" style={styles.navButton}><span>🏥</span> Gestion Pros de Santé →</Link>
        <Link to="/app/clients" className="nav-btn" style={styles.navButton}><span>👥</span> Gestion Clients Pros →</Link>
        <Link to="/app/tutoriel" className="nav-btn" style={styles.navButton}><span>📘</span> Tutoriel →</Link>
        <Link to="/app/analytique" className="nav-btn" style={styles.navButton}><span>📊</span> Analytique →</Link>
      </div>

      <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
        <details style={styles.infoDetails}>
          <summary style={styles.infoSummary}>ℹ️ Guide d'activation (Cliquez pour dérouler)</summary>
          <div style={{ padding: "0 20px 20px 20px", color: "#555", fontSize: "0.95rem", lineHeight: "1.5" }}>
            <p style={{marginTop: 0}}><strong>Contrôle des réductions :</strong></p>
            <ul style={{ paddingLeft: "20px", margin: "10px 0" }}>
                <li><strong>État Actif :</strong> Le code promo est utilisable immédiatement.</li>
                <li><strong>État Inactif :</strong> Le code est désactivé temporairement.</li>
            </ul>
          </div>
        </details>
      </div>

      <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
        <div style={{ backgroundColor: "white", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fafafa" }}>
            <h2 style={{ margin: 0, color: "#444", fontSize: "1.1rem", fontWeight: "600" }}>Liste des Codes Promo ({entries.length})</h2>
          </div>
          
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1200px" }}>
              <thead>
                <tr style={{ backgroundColor: "white", borderBottom: "2px solid #eee" }}>
                  <th style={{...thStyle, width: "20%"}}>Nom Pro</th>
                  <th style={{...thStyle, width: "25%"}}>Email</th>
                  
                  <th style={{...thStyle, ...thPromoBorder, backgroundColor: "#f1f8f5", color: "#008060", width: "15%"}}>Nom Code</th>
                  <th style={{...thPromoStyle, width: "15%"}}>Code Promo</th>
                  <th style={thPromoStyle}>Valeur</th>
                  <th style={thPromoStyle}>État</th>
                  
                  <th style={{...thActionStyle, width: "10%"}}>Action</th>
                  <th style={{...thCenter, width: "5%"}}>Lien</th>
                </tr>
              </thead>
              <tbody>
                {/* ETAT VIDE (EMPTY STATE) */}
                {currentEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "30px", textAlign: "center", color: "#888", fontSize: "0.95rem" }}>
                      Aucun code promo créé via la Gestion des Pros.
                    </td>
                  </tr>
                ) : (
                  currentEntries.map((entry: any, index: number) => {
                    const isUpdatingThis = fetcher.formData?.get("id") === entry.id && fetcher.state !== "idle";
                    let isActive = entry.status !== false; 
                    if (isUpdatingThis) isActive = fetcher.formData?.get("new_status") === "true";

                    const bgStandard = index % 2 === 0 ? "white" : "#fafafa";
                    const bgPromo = index % 2 === 0 ? "#f7fbf9" : "#eef6f3";
                    const borderLeftSep = { borderLeft: "2px solid #e1e3e5" };

                    return (
                      <tr key={entry.id}>
                        {/* Nom (Utilise displayName qui est le Nom Réel du client si dispo) */}
                        <td style={{ ...styles.cell, backgroundColor: bgStandard, fontWeight: "600", color: "#333" }}>
                            {entry.displayName || entry.name}
                        </td>
                        <td style={{ ...styles.cell, backgroundColor: bgStandard, color: "#666" }}>{entry.email}</td>
                        
                        {/* Nom Code */}
                        <td style={{ ...styles.cell, backgroundColor: bgPromo, ...borderLeftSep, color: "#555", fontSize: "0.85rem", fontStyle: "italic" }}>
                           Code promo Pro Sante - {entry.displayName || entry.name}
                        </td>

                        {/* Code Promo */}
                        <td style={{ ...styles.cellPromo, backgroundColor: bgPromo }}>
                          <span style={{ ...styles.badgeCode, opacity: isActive ? 1 : 0.5, backgroundColor: isActive ? "#e3f1df" : "#eee", color: isActive ? "#008060" : "#666" }}>
                            {entry.code}
                          </span>
                        </td>
                        
                        <td style={{ ...styles.cellFit, backgroundColor: bgPromo }}><strong>{entry.montant} {entry.type}</strong></td>

                        <td style={{ ...styles.cellFit, backgroundColor: bgPromo }}>
                          {entry.discount_id ? (
                             isActive ? 
                              <span style={{ color: "#008060", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "6px" }}><span style={{fontSize: "1rem"}}>●</span> Actif</span> : 
                              <span style={{ color: "#666", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "6px" }}><span style={{fontSize: "1rem"}}>○</span> Inactif</span>
                          ) : (
                            <span style={{ color: "#d82c0d", fontSize: "0.85rem", backgroundColor: "#fff0f0", padding: "2px 6px", borderRadius: "4px" }}>⚠ Non lié</span>
                          )}
                        </td>

                        <td style={{ ...styles.cellPromo, backgroundColor: bgStandard, textAlign: "center", ...borderLeftSep }}>
                           {entry.discount_id && (
                             <fetcher.Form method="post">
                               <input type="hidden" name="action" value="toggle_status" />
                               <input type="hidden" name="id" value={entry.id} />
                               <input type="hidden" name="new_status" value={(!isActive).toString()} />
                               <button type="submit" disabled={isUpdatingThis} style={{
                                   padding: "6px 10px", backgroundColor: isActive ? "white" : "#008060", color: isActive ? "#d82c0d" : "white",
                                   border: isActive ? "1px solid #e0e0e0" : "none", borderRadius: "6px", cursor: isUpdatingThis ? "default" : "pointer",
                                   fontWeight: "600", fontSize: "0.8rem", transition: "all 0.2s",
                                   boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.05)" : "0 1px 3px rgba(0,0,0,0.1)",
                                   minWidth: "90px", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px"
                                 }}>
                                 {isUpdatingThis ? <><Spinner color={isActive ? "#d82c0d" : "white"} /> ...</> : (isActive ? "Désactiver" : "Activer")}
                               </button>
                             </fetcher.Form>
                           )}
                        </td>

                        <td style={{ ...styles.cellCenter, backgroundColor: bgStandard }}>
                          {entry.discount_id ? (
                               <a href={`shopify:admin/discounts/${extractId(entry.discount_id)}`} target="_top" style={styles.adminBtn} title="Voir dans Shopify">↗</a>
                          ) : (<span style={{color: "#ccc"}}>-</span>)}
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {entries.length > itemsPerPage && (
            <div style={styles.paginationContainer}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={currentPage === 1 ? styles.pageBtnDisabled : styles.pageBtn}>← Précédent</button>
              <span style={{ fontSize: "0.9rem", color: "#555" }}>Page <strong>{currentPage}</strong> sur <strong>{totalPages || 1}</strong></span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={currentPage === totalPages ? styles.pageBtnDisabled : styles.pageBtn}>Suivant →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}