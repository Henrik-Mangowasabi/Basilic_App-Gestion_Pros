import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const metaobjectId = formData.get("metaobjectId") as string;
  const code = formData.get("code") as string;

  if (!metaobjectId || !code) {
    return new Response(JSON.stringify({ error: "metaobjectId and code sont requis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const codeUpper = code.toUpperCase();

  // Récupérer tous les codes enregistrés pour construire la même requête OR qu'Analytique
  // (Shopify retourne des résultats incomplets avec un seul discount_code:X,
  //  mais retourne tous les ordres affiliés avec une requête OR multi-codes)
  const allEntriesResult = await getMetaobjectEntries(admin);
  const allCodes = [...new Set<string>(
    allEntriesResult.entries
      .map((e: any) => e.code?.toUpperCase())
      .filter(Boolean)
  )];

  const codeQuery = allCodes.length > 0
    ? allCodes.map(c => `discount_code:${c}`).join(" OR ")
    : `discount_code:${codeUpper}`;

  const orderQuery = `#graphql
    query GetOrdersByCode($qs: String!, $cursor: String) {
      orders(first: 250, query: $qs, after: $cursor) {
        edges {
          node {
            subtotalPriceSet {
              shopMoney { amount }
            }
            discountCodes
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  let totalRevenue = 0;
  let totalOrders = 0;
  let hasMore = true;
  let cursor: string | null = null;
  let pages = 0;
  const maxPages = 20; // 5000 commandes max

  try {
    while (hasMore && pages < maxPages) {
      const resp = await admin.graphql(orderQuery, {
        variables: { qs: codeQuery, cursor },
      });
      const data = await resp.json() as any;

      for (const edge of data.data?.orders?.edges || []) {
        const order = edge.node;
        const codes: string[] = order.discountCodes || [];
        // Filtrer uniquement les commandes qui utilisent exactement le code de ce pro
        if (codes.some((c: string) => c.toUpperCase() === codeUpper)) {
          totalRevenue += parseFloat(order.subtotalPriceSet?.shopMoney?.amount || "0");
          totalOrders++;
        }
      }

      hasMore = data.data?.orders?.pageInfo?.hasNextPage ?? false;
      cursor = data.data?.orders?.pageInfo?.endCursor ?? null;
      pages++;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: `Erreur requête commandes: ${String(e)}` }), {
      headers: { "Content-Type": "application/json" },
    });
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

  return new Response(JSON.stringify({
    success: true,
    totalRevenue,
    totalOrders,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};
