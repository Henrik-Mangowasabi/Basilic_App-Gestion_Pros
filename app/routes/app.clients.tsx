// FICHIER : app/routes/app.clients.tsx
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);

  // 1. Récupération des Pros (Metaobjets)
  const metaEntriesResult = await getMetaobjectEntries(admin);
  const metaEntries = metaEntriesResult.entries || [];

  // 2. Récupération des Clients (Mode Sécurisé + Tags)
  let allCustomers: any[] = [];
  let hasNextPage = true;
  let cursor = null;

  try {
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
        query getAllCustomers($cursor: String) {
          customers(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                firstName
                lastName
                email
                tags
                # On récupère les metafields si tu en as pour le 'crédit utilisé'
                metafield(namespace: "custom", key: "credit_used") { value }
              }
            }
          }
        }`,
        { variables: { cursor } }
      );
      const data = await response.json();
      if (data.errors) break;

      allCustomers = allCustomers.concat(data.data.customers.edges.map((e: any) => e.node));
      cursor = data.data.customers.pageInfo.endCursor;
      hasNextPage = data.data.customers.pageInfo.hasNextPage;
    }
  } catch (error) {
    console.log("Erreur Customers:", error);
  }

  // 3. Filtrage : On ne garde que les 'pro_sante'
  const proSanteCustomers = allCustomers.filter((c: any) => 
    c.tags && c.tags.includes('pro_sante')
  );

  // 4. LIAISON ET CALCULS FINANCIERS (C'est ici que la magie opère)
  const combinedData = await Promise.all(proSanteCustomers.map(async (customer: any) => {
    // A. On trouve le Pro associé
    const linkedEntry = metaEntries.find((e: any) => 
      e.customer_id === customer.id || 
      (e.email && customer.email && e.email.toLowerCase() === customer.email.toLowerCase())
    );

    const codePromo = linkedEntry ? linkedEntry.code : null;
    let stats = { count: 0, totalRevenue: 0 };

    // B. Si un code existe, on va chercher les commandes liées à ce code
    if (codePromo) {
      try {
        // On cherche les commandes qui ont utilisé ce code promo spécifique
        const orderResponse = await admin.graphql(
          `#graphql
          query getOrdersByCode($query: String!) {
            orders(first: 50, query: $query) {
              nodes {
                id
                totalPriceSet {
                  shopMoney { amount }
                }
              }
            }
          }`,
          { variables: { query: `discount_code:${codePromo}` } } // Filtre magique
        );
        
        const orderData = await orderResponse.json();
        const orders = orderData.data?.orders?.nodes || [];

        // Calculs
        stats.count = orders.length;
        stats.totalRevenue = orders.reduce((sum: number, order: any) => {
          return sum + parseFloat(order.totalPriceSet?.shopMoney?.amount || "0");
        }, 0);

      } catch (err) {
        console.error(`Erreur récupération commandes pour ${codePromo}`, err);
      }
    }

    // C. Calcul du Store Credit
    // Règle : 10€ gagnés tous les 500€ de CA
    const creditEarned = Math.floor(stats.totalRevenue / 500) * 10;
    
    // Pour le crédit utilisé, on regarde si un champ existe (sinon 0 par défaut)
    const creditUsed = customer.metafield?.value ? parseFloat(customer.metafield.value) : 0;
    
    const creditRemaining = creditEarned - creditUsed;

    return {
      ...customer,
      linkedCode: codePromo || "⚠️ Pas de lien",
      linkedStatus: linkedEntry ? (linkedEntry.status ? "Actif" : "Inactif") : "-",
      
      // Nouvelles données calculées
      ordersCount: stats.count,
      totalRevenue: stats.totalRevenue,
      creditEarned: creditEarned,
      creditUsed: creditUsed,
      creditRemaining: creditRemaining
    };
  }));

  return { clients: combinedData };
};

export default function ClientsPage() {
  const { clients } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "2rem", backgroundColor: "#f6f6f7", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}> {/* J'ai élargi la page pour faire tenir les colonnes */}
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#202223" }}>Performance Pros Santé ({clients.length})</h1>
          <Link to="/app" style={{ textDecoration: "none", color: "#008060", fontWeight: "bold" }}>← Retour Gestion</Link>
        </div>

        <div style={{ backgroundColor: "white", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
            <thead>
              <tr style={{ backgroundColor: "#fafafa", borderBottom: "1px solid #e1e3e5" }}>
                <th style={{ padding: "16px", textAlign: "left", color: "#444" }}>Pro (Client)</th>
                <th style={{ padding: "16px", textAlign: "left", color: "#444" }}>Code Promo</th>
                
                {/* Section Performance */}
                <th style={{ padding: "16px", textAlign: "center", color: "#008060", backgroundColor: "#f1f8f5" }}>Commandes</th>
                <th style={{ padding: "16px", textAlign: "right", color: "#008060", backgroundColor: "#f1f8f5" }}>CA Généré</th>
                
                {/* Section Store Credit */}
                <th style={{ padding: "16px", textAlign: "right", color: "#9c6ade", backgroundColor: "#f9f4ff" }}>Crédit Gagné</th>
                <th style={{ padding: "16px", textAlign: "right", color: "#9c6ade", backgroundColor: "#f9f4ff" }}>Utilisé</th>
                <th style={{ padding: "16px", textAlign: "right", color: "#9c6ade", backgroundColor: "#f9f4ff", fontWeight: "bold" }}>RESTANT</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "20px", textAlign: "center", color: "#888" }}>Aucun client 'pro_sante' trouvé.</td></tr>
              ) : (
                clients.map((client: any, i: number) => (
                  <tr key={client.id} style={{ borderBottom: "1px solid #eee", backgroundColor: i % 2 === 0 ? "white" : "#fcfcfc" }}>
                    
                    {/* Identité */}
                    <td style={{ padding: "16px" }}>
                      <div style={{ fontWeight: "600" }}>{client.firstName} {client.lastName}</div>
                      <div style={{ fontSize: "0.85rem", color: "#666" }}>{client.email}</div>
                      <div style={{ marginTop: "4px" }}>
                         {client.tags.includes('pro_sante') && <span style={{fontSize:"0.7rem", background:"#ddd", padding:"2px 4px", borderRadius:"3px"}}>TAG: pro_sante</span>}
                      </div>
                    </td>

                    {/* Code Promo */}
                    <td style={{ padding: "16px" }}>
                       {client.linkedCode !== "⚠️ Pas de lien" ? (
                         <span style={{ backgroundColor: "#e3f1df", color: "#008060", padding: "4px 8px", borderRadius: "4px", fontFamily: "monospace", fontWeight: "bold" }}>
                           {client.linkedCode}
                         </span>
                       ) : (
                         <span style={{ color: "#d82c0d", fontSize: "0.85rem" }}>⚠ Non lié</span>
                       )}
                    </td>

                    {/* Performance (Commandes & CA) */}
                    <td style={{ padding: "16px", textAlign: "center", fontWeight: "500", fontSize: "1.1rem" }}>
                      {client.ordersCount}
                    </td>
                    <td style={{ padding: "16px", textAlign: "right", fontWeight: "bold" }}>
                      {client.totalRevenue.toFixed(2)} €
                    </td>

                    {/* Store Credit */}
                    <td style={{ padding: "16px", textAlign: "right", color: "#555" }}>
                      {client.creditEarned > 0 ? `+${client.creditEarned} €` : "-"}
                    </td>
                    <td style={{ padding: "16px", textAlign: "right", color: "#888" }}>
                      {client.creditUsed > 0 ? `-${client.creditUsed} €` : "-"}
                    </td>
                    <td style={{ padding: "16px", textAlign: "right" }}>
                      <span style={{ 
                        backgroundColor: client.creditRemaining > 0 ? "#9c6ade" : "#eee", 
                        color: client.creditRemaining > 0 ? "white" : "#888",
                        padding: "6px 12px", borderRadius: "20px", fontWeight: "bold" 
                      }}>
                        {client.creditRemaining} €
                      </span>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        <div style={{ marginTop: "20px", fontSize: "0.9rem", color: "#666", fontStyle: "italic" }}>
          * Règle de calcul : 10€ de Store Credit gagnés tous les 500€ de chiffre d'affaires généré par le code promo.
        </div>
      </div>
    </div>
  );
}