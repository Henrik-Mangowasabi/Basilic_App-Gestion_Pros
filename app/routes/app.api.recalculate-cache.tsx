import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { updateCustomerProMetafields } from "../lib/customer.server";
import { queryAllOrdersForCode } from "../lib/orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
      // Étape 1 : REST API (rapide — filtre par code, trouve commandes même si discount recréé)
      let restCount = 0;
      let restRevenue = 0;
      let restSuccess = false;

      // DEBUG TEMPORAIRE : inspecter JM203098 directement par son ID numérique Shopify
      try {
        const debugId = "12717639172474";
        const debugUrl = `https://${session.shop}/admin/api/2025-10/orders/${debugId}.json?fields=id,name,created_at,discount_codes,discount_applications,line_items`;
        console.log(`[DEBUG] Fetch order ID ${debugId}`);
        const debugResp = await fetch(debugUrl, { headers: { "X-Shopify-Access-Token": session.accessToken!, "Content-Type": "application/json" } });
        console.log(`[DEBUG] order ${debugId} HTTP: ${debugResp.status}`);
        const debugData = await debugResp.json() as any;
        const o = debugData.order;
        if (o) {
          console.log(`[DEBUG ${o.name}] date=${o.created_at?.slice(0,10)}`);
          console.log(`[DEBUG ${o.name}] discount_codes: ${JSON.stringify(o.discount_codes)}`);
          console.log(`[DEBUG ${o.name}] discount_applications: ${JSON.stringify(o.discount_applications)}`);
          console.log(`[DEBUG ${o.name}] line_items[0].discount_allocations: ${JSON.stringify(o.line_items?.[0]?.discount_allocations)}`);
        } else {
          console.log(`[DEBUG order ${debugId}] non trouvée: ${JSON.stringify(debugData)}`);
        }
      } catch(e) { console.error(`[DEBUG order 12717639172474] erreur:`, e); }

      try {
        const restUrl = `https://${session.shop}/admin/api/2025-10/orders.json?discount_code=${encodeURIComponent(codeUpper)}&status=any&limit=250&fields=id,name,created_at,discount_codes,subtotal_price,financial_status,cancel_reason,refunds`;
        const restResp = await fetch(restUrl, {
          headers: {
            "X-Shopify-Access-Token": session.accessToken!,
            "Content-Type": "application/json",
          },
        });
        const restData = await restResp.json() as any;
        const restOrders = restData.orders || [];
        console.log(`[REST API] ${codeUpper}: ${restOrders.length} commandes brutes`);

        for (const o of restOrders) {
          if (o.financial_status === "refunded" || o.financial_status === "voided" || o.cancel_reason) continue;
          const subtotal = parseFloat(o.subtotal_price || "0");
          let productRefunded = 0;
          for (const refund of o.refunds || []) {
            for (const ri of refund.refund_line_items || []) {
              productRefunded += parseFloat(ri.subtotal || "0");
            }
          }
          restRevenue += Math.max(0, subtotal - productRefunded);
          restCount++;
          console.log(`[REST API] ✓ ${o.name} (${o.created_at?.slice(0,10)}) subtotal=${o.subtotal_price}`);
        }
        console.log(`[REST API] Résultat: ${restCount} commandes valides, CA=${restRevenue.toFixed(2)}€`);
        restSuccess = true;
      } catch (restErr) {
        console.warn(`[REST API] Erreur, fallback scan complet:`, restErr);
      }

      if (restSuccess) {
        // REST API a fonctionné → résultat direct, pas de scan complet
        totalRevenue = restRevenue;
        totalOrders = restCount;
      } else {
        // Fallback : scan complet GraphQL (plus lent mais exhaustif)
        const stats = await queryAllOrdersForCode(admin, codeUpper);
        totalRevenue = stats.revenue;
        totalOrders = stats.count;
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
