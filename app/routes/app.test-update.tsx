// Route pour tester manuellement la mise à jour d'un metaobject
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const result = await getMetaobjectEntries(admin);
  const entries = result.entries || [];
  
  return {
    metaobjects: entries.map((e: any) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      cache_revenue: e.cache_revenue || "0",
      cache_orders_count: e.cache_orders_count || "0",
      cache_credit_earned: e.cache_credit_earned || "0"
    }))
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const metaobjectId = formData.get("metaobjectId") as string;
  const testAmount = parseFloat(formData.get("testAmount") as string) || 0;
  
  if (!metaobjectId || testAmount <= 0) {
    return { error: "Veuillez sélectionner un metaobject et entrer un montant valide" };
  }
  
  try {
    // Récupérer le metaobject actuel
    const query = `#graphql
      query getMetaobject($id: ID!) {
        metaobject(id: $id) {
          id
          fields {
            key
            value
          }
        }
      }
    `;
    
    const response = await admin.graphql(query, { variables: { id: metaobjectId } });
    const data = await response.json() as any;
    const metaobject = data.data?.metaobject;
    
    if (!metaobject) {
      return { error: "Metaobject non trouvé" };
    }
    
    // Récupérer les valeurs actuelles
    let currentRevenue = 0;
    let currentCount = 0;
    let previousCreditEarned = 0;
    
    metaobject.fields.forEach((f: any) => {
      if (f.key === "cache_revenue" && f.value) currentRevenue = parseFloat(f.value);
      if (f.key === "cache_orders_count" && f.value) currentCount = parseInt(f.value);
      if (f.key === "cache_credit_earned" && f.value) previousCreditEarned = parseFloat(f.value);
    });
    
    // Calculer les nouvelles valeurs (simuler une commande)
    const newRevenue = currentRevenue + testAmount;
    const newCount = currentCount + 1;
    const totalCreditShouldBe = Math.floor(newRevenue / 20) * 10;
    
    // Mettre à jour le metaobject
    const updateMutation = `#graphql
      mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;
    
    const updateResponse = await admin.graphql(updateMutation, {
      variables: {
        id: metaobjectId,
        metaobject: {
          fields: [
            { key: "cache_revenue", value: String(newRevenue) },
            { key: "cache_orders_count", value: String(newCount) },
            { key: "cache_credit_earned", value: String(totalCreditShouldBe) }
          ]
        }
      }
    });
    
    const updateData = await updateResponse.json() as any;
    
    if (updateData.data?.metaobjectUpdate?.userErrors?.length > 0) {
      return { error: updateData.data.metaobjectUpdate.userErrors[0].message };
    }
    
    return {
      success: true,
      message: `Metaobject mis à jour avec succès ! CA: ${currentRevenue}€ → ${newRevenue}€ | Commandes: ${currentCount} → ${newCount}`
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export default function TestUpdatePage() {
  const { metaobjects } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  
  return (
    <div style={{ padding: "20px", fontFamily: "-apple-system, sans-serif", backgroundColor: "#f6f6f7", minHeight: "100vh" }}>
      <h1 style={{ color: "#202223", marginBottom: "20px" }}>🧪 Test Mise à Jour Manuelle</h1>
      
      <div style={{ display: "flex", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link to="/app" style={{ textDecoration: "none", color: "#008060", fontWeight: "600", backgroundColor: "white", border: "1px solid #c9cccf", padding: "8px 16px", borderRadius: "4px" }}>← Retour</Link>
      </div>
      
      {actionData?.error && (
        <div style={{ padding: "15px", backgroundColor: "#f8d7da", borderRadius: "8px", color: "#721c24", marginBottom: "20px" }}>
          <strong>Erreur :</strong> {actionData.error}
        </div>
      )}
      
      {actionData?.success && (
        <div style={{ padding: "15px", backgroundColor: "#d4edda", borderRadius: "8px", color: "#155724", marginBottom: "20px" }}>
          <strong>✅ Succès :</strong> {actionData.message}
        </div>
      )}
      
      <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)", marginBottom: "20px" }}>
        <h2 style={{ color: "#008060", marginTop: 0 }}>Tester la mise à jour manuellement</h2>
        <p style={{ color: "#666" }}>Cette page permet de simuler une commande et de mettre à jour manuellement un metaobject pour tester le système.</p>
        
        <Form method="post" style={{ marginTop: "20px" }}>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", color: "#333" }}>
              Sélectionner un metaobject :
            </label>
            <select 
              name="metaobjectId" 
              required
              style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px" }}
            >
              <option value="">-- Choisir un metaobject --</option>
              {metaobjects.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code}) - CA actuel: {parseFloat(m.cache_revenue).toFixed(2)}€
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", color: "#333" }}>
              Montant de la commande test (€) :
            </label>
            <input 
              type="number" 
              name="testAmount" 
              required 
              min="0.01" 
              step="0.01"
              placeholder="Ex: 25.00"
              style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px" }}
            />
          </div>
          
          <button 
            type="submit"
            style={{ 
              padding: "10px 20px", 
              backgroundColor: "#008060", 
              color: "white", 
              border: "none", 
              borderRadius: "4px", 
              fontSize: "14px", 
              fontWeight: "600",
              cursor: "pointer"
            }}
          >
            🧪 Tester la mise à jour
          </button>
        </Form>
      </div>
      
      <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
        <h2 style={{ color: "#005bd3", marginTop: 0 }}>Metaobjects ({metaobjects.length})</h2>
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
      
      <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#fff3cd", borderRadius: "8px", border: "1px solid #ffc107" }}>
        <h3 style={{ marginTop: 0, color: "#856404" }}>💡 Instructions</h3>
        <ol style={{ color: "#856404", lineHeight: "1.8" }}>
          <li>Sélectionnez un metaobject dans la liste</li>
          <li>Entrez un montant de test (ex: 25€)</li>
          <li>Cliquez sur &quot;Tester la mise à jour&quot;</li>
          <li>Le système va simuler une commande et mettre à jour le metaobject</li>
          <li>Rechargez la page pour voir les nouvelles valeurs</li>
        </ol>
        <p style={{ color: "#856404", marginTop: "10px" }}>
          <strong>Note :</strong> Cette page teste uniquement la mise à jour du metaobject. Pour tester le webhook réel, créez une vraie commande dans Shopify et vérifiez les logs sur Render.
        </p>
      </div>
    </div>
  );
}

