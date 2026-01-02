// FICHIER : app/routes/app.clients.tsx
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getProSanteCustomers } from "../lib/customer.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  
  // On récupère les deux listes en parallèle
  const [customers, metaEntriesResult] = await Promise.all([
    getProSanteCustomers(admin),
    getMetaobjectEntries(admin)
  ]);

  const metaEntries = metaEntriesResult.entries || [];

  // On fait le lien entre les deux via l'Email
  const combinedData = customers.map((customer: any) => {
    // CORRECTION : On cherche d'abord par ID (plus fiable), sinon par Email
    const linkedEntry = metaEntries.find((e: any) => 
      e.customer_id === customer.id || 
      e.email?.toLowerCase() === customer.email?.toLowerCase()
    );
    
    return {
      ...customer,
      // Si on a trouvé une entrée liée
      linkedCode: linkedEntry ? linkedEntry.code : "⚠️ Pas de lien",
      // ... (reste du return inchangé)
    };
  });

  return { clients: combinedData };
};

export default function ClientsPage() {
  const { clients } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "2rem", backgroundColor: "#f6f6f7", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#202223" }}>Clients Pro Santé ({clients.length})</h1>
          <Link to="/app" style={{ textDecoration: "none", color: "#008060", fontWeight: "bold" }}>← Retour Gestion</Link>
        </div>

        <div style={{ backgroundColor: "white", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#fafafa", borderBottom: "1px solid #e1e3e5" }}>
                <th style={{ padding: "16px", textAlign: "left", fontSize: "0.9rem", color: "#444" }}>Nom du Client</th>
                <th style={{ padding: "16px", textAlign: "left", fontSize: "0.9rem", color: "#444" }}>Email</th>
                <th style={{ padding: "16px", textAlign: "left", fontSize: "0.9rem", color: "#444" }}>Code Promo Lié</th>
                <th style={{ padding: "16px", textAlign: "left", fontSize: "0.9rem", color: "#444" }}>Réduction</th>
                <th style={{ padding: "16px", textAlign: "left", fontSize: "0.9rem", color: "#444" }}>Statut Promo</th>
                <th style={{ padding: "16px", textAlign: "right", fontSize: "0.9rem", color: "#444" }}>Dépenses Totales</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "#888" }}>Aucun client avec le tag 'pro_sante' trouvé.</td></tr>
              ) : (
                clients.map((client: any, i: number) => (
                  <tr key={client.id} style={{ borderBottom: "1px solid #eee", backgroundColor: i % 2 === 0 ? "white" : "#fcfcfc" }}>
                    <td style={{ padding: "16px", fontWeight: "500" }}>{client.firstName} {client.lastName}</td>
                    <td style={{ padding: "16px", color: "#555" }}>{client.email}</td>
                    
                    {/* Colonne Code Promo (Lien intelligent) */}
                    <td style={{ padding: "16px" }}>
                       {client.linkedCode !== "⚠️ Pas de lien" ? (
                         <span style={{ backgroundColor: "#e3f1df", color: "#008060", padding: "4px 8px", borderRadius: "4px", fontFamily: "monospace", fontWeight: "bold" }}>
                           {client.linkedCode}
                         </span>
                       ) : (
                         <span style={{ color: "#d82c0d", fontSize: "0.85rem" }}>⚠ Non synchronisé</span>
                       )}
                    </td>
                    
                    <td style={{ padding: "16px" }}>{client.linkedAmount}</td>
                    
                    <td style={{ padding: "16px" }}>
                        {client.linkedStatus === "Actif" && <span style={{color: "#008060"}}>● Actif</span>}
                        {client.linkedStatus === "Inactif" && <span style={{color: "#666"}}>○ Inactif</span>}
                    </td>

                    <td style={{ padding: "16px", textAlign: "right", fontWeight: "bold" }}>
                      {client.totalSpent} {client.currencyCode || "EUR"} <br/>
                      <span style={{ fontSize: "0.75rem", fontWeight: "normal", color: "#888" }}>({client.ordersCount} commandes)</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#e8f4fd", borderRadius: "6px", color: "#0d3d66", fontSize: "0.9rem" }}>
          ℹ️ <b>Info :</b> Cette page affiche les clients Shopify ayant le tag <code>pro_sante</code>. Les informations de code promo sont récupérées dynamiquement en faisant correspondre l'email du client avec l'email dans votre liste de Pros.
        </div>

      </div>
    </div>
  );
}