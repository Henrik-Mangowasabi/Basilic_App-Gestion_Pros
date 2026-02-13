import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  getMetaobjectEntries,
  checkMetaobjectStatus,
} from "../lib/metaobject.server";
import { appConfig } from "../config.server";
import { Pagination } from "../components/Pagination";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const status = await checkMetaobjectStatus(admin);
  if (!status.exists)
    return { clients: [] as any[], isInitialized: false, config: null };

  const config = appConfig;

  // SÉCURITÉ : On s'assure que entries est toujours un tableau
  const result = await getMetaobjectEntries(admin);
  const entries = result.entries || [];

  if (entries.length === 0)
    return { clients: [] as any[], isInitialized: true, config };

  const customerIds = entries
    .map((e: any) => e.customer_id)
    .filter((id: string) => id && id.startsWith("gid://shopify/Customer/"));

  const customerMap = new Map<string, any>();

  if (customerIds.length > 0) {
    const query = `#graphql
      query getCustomersDetails($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            firstName
            lastName
            email
            storeCreditAccounts(first: 1) {
              edges {
                node {
                  balance {
                    amount
                  }
                }
              }
            }
          }
        }
      }
    `;
    try {
      const response = await admin.graphql(query, {
        variables: { ids: customerIds },
      });
      const data: any = await response.json();
      const nodes = data.data?.nodes || [];
      nodes.forEach((n: any) => {
        if (n) customerMap.set(n.id, n);
      });
    } catch (e) {
      console.error("Erreur Bulk Customers", e);
    }
  }

  const combinedData = entries.map((entry: any) => {
    const shopifyCustomer = customerMap.get(entry.customer_id);

    const totalRevenue = entry.cache_revenue
      ? parseFloat(entry.cache_revenue)
      : 0;
    const ordersCount = entry.cache_orders_count
      ? parseInt(entry.cache_orders_count)
      : 0;

    // Utilisation de la CONFIG DYNAMIQUE
    const currentThreshold = config?.threshold || 500.0;
    const currentAmount = config?.creditAmount || 10.0;
    const creditEarned =
      Math.floor(totalRevenue / currentThreshold) * currentAmount;

    // Récupération du solde REEL sur Shopify
    const storeCreditAccount =
      shopifyCustomer?.storeCreditAccounts?.edges?.[0]?.node;
    const currentBalance = storeCreditAccount?.balance?.amount
      ? parseFloat(storeCreditAccount.balance.amount)
      : 0;

    // Utilisé = Gagné - Ce qu'il reste sur le compte
    const creditUsed = Math.max(0, creditEarned - currentBalance);
    const creditRemaining = currentBalance;

    return {
      id: entry.customer_id || entry.id,
      firstName:
        shopifyCustomer?.firstName ||
        entry.first_name ||
        (entry.name ? entry.name.split(" ")[0] : "Inconnu"),
      lastName:
        shopifyCustomer?.lastName ||
        entry.last_name ||
        (entry.name ? entry.name.split(" ").slice(1).join(" ") : ""),
      email: shopifyCustomer?.email || entry.email,
      linkedCode: entry.code,
      ordersCount: ordersCount,
      totalRevenue: totalRevenue,
      creditEarned,
      creditUsed,
      creditRemaining,
      profession: entry.profession || "-",
      adresse: entry.adresse || "-",
    };
  });

  return { clients: combinedData, isInitialized: true, config };
};

// Helper ID
const extractId = (gid: string) => (gid ? gid.split("/").pop() : "");

export default function ClientsPage() {
  const { clients, isInitialized, config } = useLoaderData<typeof loader>();
  const [currentPage, setCurrentPage] = useState(1);

  if (!isInitialized) {
    return (
      <div
        style={{
          width: "100%",
          height: "80vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#f6f6f7",
        }}
      >
        <div
          style={{
            backgroundColor: "white",
            padding: "40px",
            borderRadius: "16px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            maxWidth: "500px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontSize: "1.2rem",
              marginBottom: "15px",
              color: "#d82c0d",
            }}
          >
            Application non initialisée
          </h2>
          <p style={{ color: "#666", marginBottom: "30px" }}>
            Veuillez vous rendre sur la page principale pour configurer
            l&apos;application.
          </p>
          <Link
            to="/app"
            style={{
              textDecoration: "none",
              padding: "12px 24px",
              backgroundColor: "#008060",
              color: "white",
              borderRadius: "8px",
              fontWeight: "600",
            }}
          >
            Aller sur la page principale
          </Link>
        </div>
      </div>
    );
  }

  // SÉCURITÉ CLIENT : Empêcher le crash si clients est undefined
  const safeClients = clients || [];
  const itemsPerPage = 25;
  const totalPages = Math.ceil(safeClients.length / itemsPerPage);
  const currentClients = safeClients.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // --- STYLES RESTAURÉS ---
  const styles = {
    wrapper: {
      width: "100%",
      padding: "20px",
      backgroundColor: "#f6f6f7",
      fontFamily: "-apple-system, sans-serif",
      boxSizing: "border-box" as const,
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
      transition: "all 0.2s ease",
    },
    infoDetails: {
      marginBottom: "20px",
      backgroundColor: "white",
      borderRadius: "8px",
      border: "1px solid #e1e3e5",
      borderLeft: "4px solid #008060",
      boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
      overflow: "hidden",
    },
    infoSummary: {
      padding: "12px 20px",
      cursor: "pointer",
      fontWeight: "600",
      color: "#444",
      outline: "none",
      listStyle: "none",
    },

    // CELLULES AVEC COULEURS
    cell: {
      padding: "16px 12px",
      fontSize: "0.9rem",
      verticalAlign: "middle",
      borderBottom: "1px solid #eee",
    },
    cellCenter: {
      padding: "16px 12px",
      fontSize: "0.9rem",
      verticalAlign: "middle",
      borderBottom: "1px solid #eee",
      textAlign: "center" as const,
    },
    cellPromo: {
      padding: "16px 12px",
      fontSize: "0.9rem",
      verticalAlign: "middle",
      borderBottom: "1px solid #e1e3e5",
      textAlign: "center" as const,
    },
    cellPerf: {
      padding: "16px 12px",
      fontSize: "0.9rem",
      verticalAlign: "middle",
      borderBottom: "1px solid #b8d0eb",
      textAlign: "center" as const,
    },
    cellCredit: {
      padding: "16px 12px",
      fontSize: "0.9rem",
      verticalAlign: "middle",
      borderBottom: "1px solid #e6dff0",
      textAlign: "center" as const,
    },

    badgeCode: {
      backgroundColor: "#e3f1df",
      color: "#008060",
      padding: "4px 8px",
      borderRadius: "4px",
      fontFamily: "monospace",
      fontWeight: "bold",
      fontSize: "0.9rem",
    },
    adminBtn: {
      fontSize: "0.75rem",
      color: "#005bd3",
      textDecoration: "none",
      border: "1px solid #b8d0eb",
      padding: "4px 8px",
      borderRadius: "4px",
      backgroundColor: "#f0f8ff",
      fontWeight: "600",
    },

    paginationContainer: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "15px",
      gap: "15px",
      backgroundColor: "white",
      borderTop: "1px solid #eee",
    },
    pageBtn: {
      padding: "6px 12px",
      border: "1px solid #ccc",
      backgroundColor: "white",
      borderRadius: "4px",
      cursor: "pointer",
      color: "#333",
      fontWeight: "500",
      fontSize: "0.9rem",
    },
    pageBtnDisabled: {
      padding: "6px 12px",
      border: "1px solid #eee",
      backgroundColor: "#f9fafb",
      borderRadius: "4px",
      cursor: "not-allowed",
      color: "#ccc",
      fontWeight: "500",
      fontSize: "0.9rem",
    },
  };

  const containerMaxWidth = "1600px";

  const thStyle = {
    padding: "12px 10px",
    textAlign: "left" as const,
    fontSize: "0.8rem",
    textTransform: "uppercase" as const,
    color: "#888",
  };
  const thCenter = { ...thStyle, textAlign: "center" as const };
  const thPromoStyle = {
    ...thStyle,
    textAlign: "center" as const,
    backgroundColor: "#f1f8f5",
    color: "#008060",
    borderBottom: "2px solid #e1e3e5",
    borderLeft: "2px solid #e1e3e5",
  };
  const thPerfStyle = {
    ...thStyle,
    textAlign: "center" as const,
    backgroundColor: "#f0f8ff",
    color: "#005bd3",
    borderBottom: "2px solid #b8d0eb",
    borderLeft: "2px solid #b8d0eb",
  };
  const thCreditStyle = {
    ...thStyle,
    textAlign: "center" as const,
    backgroundColor: "#f9f4ff",
    color: "#9c6ade",
    borderBottom: "2px solid #e6dff0",
    borderLeft: "2px solid #e6dff0",
  };

  return (
    <div style={styles.wrapper}>
      <style>{`.nav-btn:hover { background-color: #f1f8f5 !important; border-color: #008060 !important; box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important; }`}</style>

      <h1
        style={{
          color: "#202223",
          marginBottom: "20px",
          textAlign: "center",
          fontSize: "1.8rem",
          fontWeight: "700",
        }}
      >
        Gestion des Clients Pros
      </h1>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "15px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        <Link to="/app" className="nav-btn" style={styles.navButton}>
          <span>🏥</span> Gestion Pros de Santé →
        </Link>
        <Link
          to="/app/codes_promo"
          className="nav-btn"
          style={styles.navButton}
        >
          <span>🏷️</span> Gestion Codes Promo →
        </Link>
        <Link to="/app/analytique" className="nav-btn" style={styles.navButton}>
          <span>📊</span> Analytique →
        </Link>
      </div>

      <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
        <details style={styles.infoDetails}>
          <summary style={styles.infoSummary}>
            ℹ️ Règles de calcul (Cliquez pour dérouler)
          </summary>
          <div
            style={{
              padding: "0 20px 20px 20px",
              color: "#555",
              fontSize: "0.95rem",
              lineHeight: "1.5",
            }}
          >
            <p style={{ marginTop: 0 }}>
              <strong>Comment est calculé le Store Credit ?</strong>
            </p>
            <ul style={{ paddingLeft: "20px", margin: "10px 0" }}>
              <li>
                <strong>Règle :</strong> {config?.creditAmount}€ de crédit sont
                gagnés pour chaque tranche de {config?.threshold}€ de chiffre
                d&apos;affaires généré.
              </li>
            </ul>
          </div>
        </details>
      </div>

      <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid #eee",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              backgroundColor: "#fafafa",
            }}
          >
            <h2
              style={{
                margin: 0,
                color: "#444",
                fontSize: "1.1rem",
                fontWeight: "600",
              }}
            >
              Liste des Clients Pros ({safeClients.length})
            </h2>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "1200px",
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "white",
                    borderBottom: "2px solid #eee",
                  }}
                >
                  <th style={{ ...thStyle, width: "15%" }}>Nom Pro</th>
                  <th style={{ ...thStyle, width: "15%" }}>Email</th>
                  <th style={{ ...thStyle, width: "15%" }}>
                    Profession / Adresse
                  </th>
                  <th style={{ ...thCenter, width: "5%" }}>Lien</th>
                  <th style={{ ...thPromoStyle, width: "10%" }}>Code Promo</th>
                  <th style={{ ...thPerfStyle, width: "7.5%" }}>Com.</th>
                  <th style={{ ...thPerfStyle, width: "10%" }}>CA Généré</th>
                  <th style={{ ...thCreditStyle, width: "9%" }}>Gagné</th>
                  <th style={{ ...thCreditStyle, width: "9%" }}>Utilisé</th>
                  <th
                    style={{
                      ...thCreditStyle,
                      width: "9.5%",
                      fontWeight: "800",
                    }}
                  >
                    RESTANT
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentClients.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        padding: "30px",
                        textAlign: "center",
                        color: "#888",
                      }}
                    >
                      Aucun client avec le tag 'pro_sante' trouvé.
                    </td>
                  </tr>
                ) : (
                  currentClients.map((client: any, i: number) => {
                    const bgStd = i % 2 === 0 ? "white" : "#fafafa";
                    const bgPromo = i % 2 === 0 ? "#f7fbf9" : "#eef6f3";
                    const bgPerf = i % 2 === 0 ? "#f0f8ff" : "#e6f2ff";
                    const bgCredit = i % 2 === 0 ? "#fcfaff" : "#f6f0fd";

                    const borderPromo = { borderLeft: "2px solid #e1e3e5" };
                    const borderPerf = { borderLeft: "2px solid #b8d0eb" };
                    const borderCredit = { borderLeft: "2px solid #e6dff0" };

                    return (
                      <tr key={client.id || i}>
                        <td style={{ ...styles.cell, backgroundColor: bgStd }}>
                          <div
                            style={{
                              fontWeight: "600",
                              color: "#333",
                              marginBottom: "4px",
                            }}
                          >
                            {client.firstName} {client.lastName}
                          </div>
                        </td>
                        <td
                          style={{
                            ...styles.cell,
                            backgroundColor: bgStd,
                            color: "#666",
                          }}
                        >
                          {client.email}
                        </td>
                        <td style={{ ...styles.cell, backgroundColor: bgStd }}>
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "#555",
                              fontWeight: "600",
                            }}
                          >
                            {client.profession}
                          </div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#888",
                              marginTop: "2px",
                            }}
                          >
                            {client.adresse}
                          </div>
                        </td>
                        <td
                          style={{
                            ...styles.cellCenter,
                            backgroundColor: bgStd,
                          }}
                        >
                          {client.id && client.id.startsWith("gid://") ? (
                            <a
                              href={`shopify:admin/customers/${extractId(client.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={styles.adminBtn}
                              title="Voir le client"
                            >
                              ↗
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>

                        <td
                          style={{
                            ...styles.cellPromo,
                            backgroundColor: bgPromo,
                            ...borderPromo,
                          }}
                        >
                          <span style={styles.badgeCode}>
                            {client.linkedCode}
                          </span>
                        </td>

                        <td
                          style={{
                            ...styles.cellPerf,
                            backgroundColor: bgPerf,
                            ...borderPerf,
                            fontWeight: "600",
                            color: "#005bd3",
                          }}
                        >
                          {client.ordersCount}
                        </td>
                        <td
                          style={{
                            ...styles.cellPerf,
                            backgroundColor: bgPerf,
                            fontWeight: "bold",
                            color: "#005bd3",
                          }}
                        >
                          {client.totalRevenue.toFixed(2)} €
                        </td>

                        <td
                          style={{
                            ...styles.cellCredit,
                            backgroundColor: bgCredit,
                            ...borderCredit,
                            color: "#008060",
                          }}
                        >
                          {client.creditEarned > 0
                            ? `+${client.creditEarned} €`
                            : "-"}
                        </td>
                        <td
                          style={{
                            ...styles.cellCredit,
                            backgroundColor: bgCredit,
                            color: "#d82c0d",
                          }}
                        >
                          {client.creditUsed > 0
                            ? `-${client.creditUsed} €`
                            : "-"}
                        </td>
                        <td
                          style={{
                            ...styles.cellCredit,
                            backgroundColor: bgCredit,
                          }}
                        >
                          <span
                            style={{
                              backgroundColor:
                                client.creditRemaining > 0 ? "#9c6ade" : "#eee",
                              color:
                                client.creditRemaining > 0 ? "white" : "#999",
                              padding: "4px 12px",
                              borderRadius: "20px",
                              fontWeight: "bold",
                              fontSize: "0.85rem",
                              whiteSpace: "nowrap",
                              display: "inline-block",
                            }}
                          >
                            {client.creditRemaining.toFixed(2)} €
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {safeClients.length > itemsPerPage && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
