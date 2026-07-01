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
    // Scan complet de toutes les commandes (pas de filtre discount_code:X) :
    // plus fiable que la recherche OR-query car Shopify peut avoir un index incomplet
    // pour les codes dont le discount a été recréé.
    try {
      const stats = await queryAllOrdersForCode(admin, codeUpper);
      totalRevenue = stats.revenue;
      totalOrders = stats.count;
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
