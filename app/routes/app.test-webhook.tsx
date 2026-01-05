// Route de test pour vérifier et tester manuellement le webhook
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  // Récupérer les metaobjects
  const result = await getMetaobjectEntries(admin);
  const entries = result.entries || [];
  
  // Récupérer les commandes récentes avec codes promo
  const ordersQuery = `#graphql
    query getRecentOrders {
      orders(first: 10, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountCodes {
              code
              amount
            }
          }
        }
      }
    }
  `;
  
  let orders: any[] = [];
  try {
    const ordersResponse = await admin.graphql(ordersQuery);
    const ordersData = await ordersResponse.json() as any;
    orders = ordersData.data?.orders?.edges?.map((e: any) => e.node) || [];
  } catch (e) {
    console.error("Erreur récupération commandes:", e);
  }
  
  return {
    metaobjects: entries.map((e: any) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      cache_revenue: e.cache_revenue || "0",
      cache_orders_count: e.cache_orders_count || "0",
      cache_credit_earned: e.cache_credit_earned || "0"
    })),
    orders: orders.map((o: any) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      total: o.totalPriceSet?.shopMoney?.amount || "0",
      subtotal: o.subtotalPriceSet?.shopMoney?.amount || "0",
      discountCodes: o.discountCodes || []
    }))
  };
};

export default function TestWebhookPage() {
  const { metaobjects, orders } = useLoaderData<typeof loader>();
  
  return (
    <div style={{ padding: "20px", fontFamily: "-apple-system, sans-serif", backgroundColor: "#f6f6f7", minHeight: "100vh" }}>
      <h1 style={{ color: "#202223", marginBottom: "20px" }}>🔍 Debug Webhook - Test</h1>
      
      <div style={{ display: "flex", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link to="/app" style={{ textDecoration: "none", color: "#008060", fontWeight: "600", backgroundColor: "white", border: "1px solid #c9cccf", padding: "8px 16px", borderRadius: "4px" }}>← Retour</Link>
      </div>
      
      <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "8px", marginBottom: "20px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
        <h2 style={{ color: "#008060", marginTop: 0 }}>Metaobjects ({metaobjects.length})</h2>
        {metaobjects.length === 0 ? (
          <p style={{ color: "#666" }}>Aucun metaobject trouvé</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee" }}>
                <th style={{ padding: "10px", textAlign: "left" }}>Nom</th>
                <th style={{ padding: "10px", textAlign: "left" }}>Code</th>
                <th style={{ padding: "10px", textAlign: "right" }}>CA Généré</th>
                <th style={{ padding: "10px", textAlign: "right" }}>Commandes</th>
                <th style={{ padding: "10px", textAlign: "right" }}>Crédit Gagné</th>
              </tr>
            </thead>
            <tbody>
              {metaobjects.map((m: any) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "10px" }}>{m.name}</td>
                  <td style={{ padding: "10px", fontFamily: "monospace", fontWeight: "bold", color: "#008060" }}>{m.code}</td>
                  <td style={{ padding: "10px", textAlign: "right" }}>{parseFloat(m.cache_revenue).toFixed(2)} €</td>
                  <td style={{ padding: "10px", textAlign: "right" }}>{m.cache_orders_count}</td>
                  <td style={{ padding: "10px", textAlign: "right", color: "#9c6ade", fontWeight: "bold" }}>{parseFloat(m.cache_credit_earned).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
        <h2 style={{ color: "#005bd3", marginTop: 0 }}>Commandes Récentes ({orders.length})</h2>
        {orders.length === 0 ? (
          <p style={{ color: "#666" }}>Aucune commande trouvée</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee" }}>
                <th style={{ padding: "10px", textAlign: "left" }}>Commande</th>
                <th style={{ padding: "10px", textAlign: "left" }}>Date</th>
                <th style={{ padding: "10px", textAlign: "right" }}>Sous-total</th>
                <th style={{ padding: "10px", textAlign: "right" }}>Total</th>
                <th style={{ padding: "10px", textAlign: "left" }}>Codes Promo</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "10px", fontFamily: "monospace", fontWeight: "bold" }}>{o.name}</td>
                  <td style={{ padding: "10px", color: "#666" }}>{new Date(o.createdAt).toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "10px", textAlign: "right" }}>{parseFloat(o.subtotal).toFixed(2)} €</td>
                  <td style={{ padding: "10px", textAlign: "right", fontWeight: "bold" }}>{parseFloat(o.total).toFixed(2)} €</td>
                  <td style={{ padding: "10px" }}>
                    {o.discountCodes.length === 0 ? (
                      <span style={{ color: "#999" }}>Aucun</span>
                    ) : (
                      o.discountCodes.map((dc: any, idx: number) => (
                        <span key={idx} style={{ 
                          backgroundColor: "#e3f1df", 
                          color: "#008060", 
                          padding: "2px 8px", 
                          borderRadius: "4px", 
                          fontFamily: "monospace",
                          marginRight: "5px",
                          fontWeight: "bold"
                        }}>
                          {dc.code}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#fff3cd", borderRadius: "8px", border: "1px solid #ffc107" }}>
        <h3 style={{ marginTop: 0, color: "#856404" }}>💡 Instructions</h3>
        <ol style={{ color: "#856404", lineHeight: "1.8" }}>
          <li>Vérifiez que les codes promo dans les commandes correspondent aux codes dans les metaobjects</li>
          <li>Si les valeurs ne sont pas à jour, le webhook n&apos;a probablement pas été déclenché</li>
          <li>Vérifiez les logs sur Render dans la section &quot;Logs&quot; pour voir si le webhook est appelé</li>
          <li>Redéployez l&apos;application avec <code style={{ backgroundColor: "#fff", padding: "2px 6px", borderRadius: "3px" }}>npm run deploy</code> pour synchroniser les webhooks</li>
        </ol>
      </div>
      
      <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#d1ecf1", borderRadius: "8px", border: "1px solid #0c5460" }}>
        <h3 style={{ marginTop: 0, color: "#0c5460" }}>📍 Où trouver les webhooks app-specific ?</h3>
        <ol style={{ color: "#0c5460", lineHeight: "1.8" }}>
          <li>Allez sur <strong>https://partners.shopify.com</strong></li>
          <li>Connectez-vous avec votre compte</li>
          <li>Cliquez sur &quot;Apps&quot; dans le menu de gauche</li>
          <li>Sélectionnez votre app &quot;App MM - Gestion Pros - JM&quot;</li>
          <li>Dans le menu de l&apos;app, cliquez sur &quot;Configuration&quot; ou &quot;App setup&quot;</li>
          <li>Cherchez la section &quot;Webhooks&quot; ou &quot;Event subscriptions&quot;</li>
          <li>Vous devriez voir &quot;orders/create&quot; listé là-bas</li>
        </ol>
        <p style={{ color: "#0c5460", marginTop: "10px", fontStyle: "italic" }}>
          <strong>Note :</strong> Les webhooks app-specific ne sont PAS visibles dans les notifications de votre store Shopify. Ils sont uniquement visibles dans le Partner Dashboard.
        </p>
      </div>
    </div>
  );
}

