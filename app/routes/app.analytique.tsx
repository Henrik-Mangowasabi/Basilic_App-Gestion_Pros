// FICHIER : app/routes/app.analytique.tsx
import { useLoaderData, Link } from "react-router";
import React, { useState } from "react";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, checkMetaobjectStatus } from "../lib/metaobject.server";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  
  const status = await checkMetaobjectStatus(admin);
  if (!status.exists) return { stats: null, ranking: [], isInitialized: false };

  const result = await getMetaobjectEntries(admin);
  const entries = result.entries || [];

  // Calcul des statistiques globales
  const totalOrders = entries.reduce((sum: number, entry: any) => {
    const count = entry.cache_orders_count ? parseInt(entry.cache_orders_count) : 0;
    return sum + count;
  }, 0);

  const totalRevenue = entries.reduce((sum: number, entry: any) => {
    const revenue = entry.cache_revenue ? parseFloat(entry.cache_revenue) : 0;
    return sum + revenue;
  }, 0);

  const activePros = entries.filter((entry: any) => entry.status !== false).length;
  const totalPros = entries.length;

  // Classement des pros par chiffre d'affaires généré
  const ranking = entries
    .map((entry: any) => ({
      id: entry.id,
      name: entry.name || "Sans nom",
      code: entry.code || "-",
      revenue: entry.cache_revenue ? parseFloat(entry.cache_revenue) : 0,
      ordersCount: entry.cache_orders_count ? parseInt(entry.cache_orders_count) : 0,
      email: entry.email || "-"
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    stats: {
      totalOrders,
      totalRevenue,
      activePros,
      totalPros
    },
    ranking,
    isInitialized: true
  };
};

// Helper ID
const extractId = (gid: string) => gid ? gid.split("/").pop() : "";

export default function AnalytiquePage() {
  const { stats, ranking, isInitialized } = useLoaderData<typeof loader>();

  if (!isInitialized) {
    return (
      <div style={{ width: "100%", height: "80vh", display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#f6f6f7" }}>
        <div style={{ backgroundColor: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", maxWidth: "500px", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "15px", color: "#d82c0d" }}>Application non initialisée</h2>
          <Link to="/app" style={{ textDecoration: "none", padding: "12px 24px", backgroundColor: "#008060", color: "white", borderRadius: "8px", fontWeight: "600" }}>
            Aller sur la page principale
          </Link>
        </div>
      </div>
    );
  }

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const totalPages = Math.ceil(ranking.length / itemsPerPage);
  const currentRanking = ranking.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const styles = {
    wrapper: { 
      width: "100%", 
      padding: "20px", 
      backgroundColor: "#f6f6f7", 
      fontFamily: "-apple-system, sans-serif", 
      boxSizing: "border-box" as const 
    },
    navButton: { 
      textDecoration: "none", 
      color: "#008060", 
      fontWeight: "600", 
      backgroundColor: "white", 
      border: "1px solid #c9cccf", 
      padding: "8px 16px", 
      borderRadius: "4px", 
      fontSize: "0.9rem", 
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)", 
      display: "flex", 
      alignItems: "center", 
      gap: "6px", 
      transition: "all 0.2s ease" 
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
      gap: "20px",
      marginBottom: "30px"
    },
    statCard: {
      backgroundColor: "white",
      borderRadius: "12px",
      padding: "24px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      borderLeft: "4px solid #008060"
    },
    statLabel: {
      fontSize: "0.85rem",
      color: "#666",
      textTransform: "uppercase",
      fontWeight: "600",
      marginBottom: "8px"
    },
    statValue: {
      fontSize: "2rem",
      fontWeight: "700",
      color: "#202223",
      margin: 0
    },
    cell: { 
      padding: "16px 12px", 
      fontSize: "0.9rem", 
      verticalAlign: "middle", 
      borderBottom: "1px solid #eee" 
    },
    cellCenter: { 
      padding: "16px 12px", 
      fontSize: "0.9rem", 
      verticalAlign: "middle", 
      borderBottom: "1px solid #eee", 
      textAlign: "center" as const 
    },
    badgeCode: { 
      backgroundColor: "#e3f1df", 
      color: "#008060", 
      padding: "4px 8px", 
      borderRadius: "4px", 
      fontFamily: "monospace", 
      fontWeight: "bold", 
      fontSize: "0.9rem" 
    },
    badgeRank: {
      backgroundColor: "#f0f8ff",
      color: "#005bd3",
      padding: "4px 10px",
      borderRadius: "20px",
      fontWeight: "bold",
      fontSize: "0.85rem",
      minWidth: "35px",
      display: "inline-block",
      textAlign: "center" as const
    },
    paginationContainer: { 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      padding: "15px", 
      gap: "15px", 
      backgroundColor: "white", 
      borderTop: "1px solid #eee" 
    },
    pageBtn: { 
      padding: "6px 12px", 
      border: "1px solid #ccc", 
      backgroundColor: "white", 
      borderRadius: "4px", 
      cursor: "pointer", 
      color: "#333", 
      fontWeight: "500", 
      fontSize: "0.9rem" 
    },
    pageBtnDisabled: { 
      padding: "6px 12px", 
      border: "1px solid #eee", 
      backgroundColor: "#f9fafb", 
      borderRadius: "4px", 
      cursor: "not-allowed", 
      color: "#ccc", 
      fontWeight: "500", 
      fontSize: "0.9rem" 
    }
  };

  const containerMaxWidth = "1600px";
  const thStyle = { 
    padding: "12px 10px", 
    textAlign: "left" as const, 
    fontSize: "0.8rem", 
    textTransform: "uppercase" as const, 
    color: "#888" 
  };
  const thCenter = { ...thStyle, textAlign: "center" as const };

  return (
    <div style={styles.wrapper}>
      <style>{`.nav-btn:hover { background-color: #f1f8f5 !important; border-color: #008060 !important; box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important; }`}</style>

      <h1 style={{ color: "#202223", marginBottom: "20px", textAlign: "center", fontSize: "1.8rem", fontWeight: "700" }}>
        Analytique
      </h1>

      <div style={{ display: "flex", justifyContent: "center", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link to="/app" className="nav-btn" style={styles.navButton}>
          <span>🏥</span> Gestion Pros de Santé →
        </Link>
        <Link to="/app/codes_promo" className="nav-btn" style={styles.navButton}>
          <span>🏷️</span> Gestion Codes Promo →
        </Link>
        <Link to="/app/clients" className="nav-btn" style={styles.navButton}>
          <span>👥</span> Gestion Clients Pros →
        </Link>
        <Link to="/app/tutoriel" className="nav-btn" style={styles.navButton}>
          <span>📘</span> Tutoriel →
        </Link>
      </div>

      <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
        {/* Statistiques globales */}
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Nombre de commandes par affiliation</div>
            <h2 style={styles.statValue}>{stats?.totalOrders || 0}</h2>
          </div>
          <div style={{...styles.statCard, borderLeftColor: "#005bd3"}}>
            <div style={styles.statLabel}>Somme totale des commandes</div>
            <h2 style={styles.statValue}>{stats?.totalRevenue.toFixed(2) || "0.00"} €</h2>
          </div>
          <div style={{...styles.statCard, borderLeftColor: "#9c6ade"}}>
            <div style={styles.statLabel}>Pros de santé actifs</div>
            <h2 style={styles.statValue}>{stats?.activePros || 0}</h2>
          </div>
          <div style={{...styles.statCard, borderLeftColor: "#666"}}>
            <div style={styles.statLabel}>Total pros enregistrés</div>
            <h2 style={styles.statValue}>{stats?.totalPros || 0}</h2>
          </div>
        </div>

        {/* Classement */}
        <div style={{ backgroundColor: "white", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fafafa" }}>
            <h2 style={{ margin: 0, color: "#444", fontSize: "1.1rem", fontWeight: "600" }}>
              Classement des Pros par Chiffre d'Affaires ({ranking.length})
            </h2>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
              <thead>
                <tr style={{ backgroundColor: "white", borderBottom: "2px solid #eee" }}>
                  <th style={{...thCenter, width: "80px"}}>Rang</th>
                  <th style={{...thStyle, width: "25%"}}>Nom Pro</th>
                  <th style={{...thStyle, width: "25%"}}>Email</th>
                  <th style={{...thCenter, width: "15%"}}>Code Promo</th>
                  <th style={{...thCenter, width: "10%"}}>Commandes</th>
                  <th style={{...thCenter, width: "15%"}}>CA Généré</th>
                </tr>
              </thead>
              <tbody>
                {currentRanking.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "30px", textAlign: "center", color: "#888" }}>
                      Aucun pro enregistré.
                    </td>
                  </tr>
                ) : (
                  currentRanking.map((pro: any, index: number) => {
                    const rank = (currentPage - 1) * itemsPerPage + index + 1;
                    const bgStd = index % 2 === 0 ? "white" : "#fafafa";
                    const isTopThree = rank <= 3;

                    return (
                      <tr key={pro.id}>
                        <td style={{ ...styles.cellCenter, backgroundColor: bgStd }}>
                          <span style={{
                            ...styles.badgeRank,
                            backgroundColor: isTopThree ? "#ffd700" : "#f0f8ff",
                            color: isTopThree ? "#333" : "#005bd3"
                          }}>
                            {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank}
                          </span>
                        </td>
                        <td style={{ ...styles.cell, backgroundColor: bgStd, fontWeight: "600", color: "#333" }}>
                          {pro.name}
                        </td>
                        <td style={{ ...styles.cell, backgroundColor: bgStd, color: "#666" }}>
                          {pro.email}
                        </td>
                        <td style={{ ...styles.cellCenter, backgroundColor: bgStd }}>
                          <span style={styles.badgeCode}>{pro.code}</span>
                        </td>
                        <td style={{ ...styles.cellCenter, backgroundColor: bgStd, fontWeight: "600", color: "#005bd3" }}>
                          {pro.ordersCount}
                        </td>
                        <td style={{ ...styles.cellCenter, backgroundColor: bgStd, fontWeight: "bold", color: "#008060", fontSize: "1rem" }}>
                          {pro.revenue.toFixed(2)} €
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {ranking.length > itemsPerPage && (
            <div style={styles.paginationContainer}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                disabled={currentPage === 1}
                style={currentPage === 1 ? styles.pageBtnDisabled : styles.pageBtn}
              >
                ← Précédent
              </button>
              <span style={{ fontSize: "0.9rem", color: "#555" }}>
                Page <strong>{currentPage}</strong> sur <strong>{totalPages || 1}</strong>
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                disabled={currentPage === totalPages}
                style={currentPage === totalPages ? styles.pageBtnDisabled : styles.pageBtn}
              >
                Suivant →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

