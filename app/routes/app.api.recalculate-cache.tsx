import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { updateCustomerProMetafields } from "../lib/customer.server";
import { queryAllOrdersForCode } from "../lib/orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const metaobjectId = formData.get("metaobjectId") as string;
  const code = formData.get("code") as string;
  const customerId = formData.get("customerId") as string | null;
  const preRevenueStr = formData.get("preRevenue") as string | null;
  const preCountStr = formData.get("preCount") as string | null;

  if (!metaobjectId || !code) {
    return new Response(JSON.stringify({ error: "metaobjectId and code sont requis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const codeUpper = code.toUpperCase();
  let totalRevenue: number;
  let totalOrders: number;

  if (preRevenueStr !== null && preCountStr !== null) {
    // Stats pré-calculées fournies par RecalculateCacheModal (Phase 1) → pas de requête Shopify
    totalRevenue = parseFloat(preRevenueStr) || 0;
    totalOrders = parseInt(preCountStr, 10) || 0;
  } else {
    try {
      // Test REST API : stocke le code en texte brut sur la commande,
      // donc fonctionne même si le discount a été supprimé et recréé.
      let restCount = 0;
      let restRevenue = 0;
      try {
        const restResp = await (admin as any).rest.get({
          path: "orders",
          query: {
            discount_code: codeUpper,
            status: "any",
            limit: 250,
            fields: "id,name,created_at,discount_codes,subtotal_price,total_discounts,financial_status,cancel_reason,refunds",
          },
        });
        const restData = await restResp.json() as any;
        const restOrders = restData.orders || [];
        console.log(`[REST API] ${codeUpper}: ${restOrders.length} commandes trouvées`);
        for (const o of restOrders) {
          const isRefunded = o.financial_status === "refunded" || o.financial_status === "voided";
          const isCancelled = !!o.cancel_reason;
          if (!isRefunded && !isCancelled) {
            const subtotal = parseFloat(o.subtotal_price || "0");
            // Calculer remboursements produits (pas shipping)
            let productRefunded = 0;
            for (const refund of o.refunds || []) {
              for (const ri of refund.refund_line_items || []) {
                productRefunded += parseFloat(ri.subtotal || "0");
              }
            }
            restRevenue += Math.max(0, subtotal - productRefunded);
            restCount++;
            console.log(`[REST API] ✓ ${o.name} (${o.created_at?.slice(0,10)}) discount_codes=${JSON.stringify(o.discount_codes)} subtotal=${o.subtotal_price}`);
          }
        }
        console.log(`[REST API] Résultat final: ${restCount} commandes, CA=${restRevenue.toFixed(2)}€`);
      } catch (restErr) {
        console.warn(`[REST API] Erreur (non bloquant):`, restErr);
      }

      // Utiliser REST si elle trouve plus que le scan GraphQL
      const graphqlStats = await queryAllOrdersForCode(admin, codeUpper);
      if (restCount > graphqlStats.count) {
        console.log(`[REST API] REST (${restCount}) > GraphQL (${graphqlStats.count}) → utilisation REST`);
        totalRevenue = restRevenue;
        totalOrders = restCount;
      } else {
        totalRevenue = graphqlStats.revenue;
        totalOrders = graphqlStats.count;
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: `Erreur requête commandes: ${String(e)}` }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // On met à jour UNIQUEMENT le CA et le nombre de commandes.
  // cache_credit_earned et cache_ca_remainder ne sont PAS recalculés :
  // on ne connaît pas l'historique des paliers/versements précédents.
  const updateResponse = await admin.graphql(`#graphql
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      id: metaobjectId,
      metaobject: {
        fields: [
          { key: "cache_revenue", value: String(totalRevenue) },
          { key: "cache_orders_count", value: String(totalOrders) },
        ],
      },
    },
  });

  const updateData = await updateResponse.json() as any;
  if (updateData.errors || updateData.data?.metaobjectUpdate?.userErrors?.length > 0) {
    return new Response(JSON.stringify({
      error: "Erreur mise à jour metaobject",
      details: updateData.errors || updateData.data?.metaobjectUpdate?.userErrors,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Mettre à jour le metafield ca_genere sur la fiche client (si lié)
  if (customerId) {
    try {
      await updateCustomerProMetafields(admin, customerId, { ca_genere: totalRevenue });
    } catch (mfError) {
      console.warn("[recalculate] Echec mise à jour ca_genere (non bloquant):", mfError);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    totalRevenue,
    totalOrders,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};
