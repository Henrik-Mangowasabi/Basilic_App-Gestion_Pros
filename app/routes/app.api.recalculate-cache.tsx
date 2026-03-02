import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopConfig } from "../config.server";

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

  const config = await getShopConfig(admin);
  const { threshold, creditAmount } = config;

  // Requête paginée pour récupérer TOUTES les commandes avec ce code promo
  const codeUpper = code.toUpperCase();
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
        variables: { qs: `discount_code:${codeUpper}`, cursor },
      });
      const data = await resp.json() as any;

      for (const edge of data.data?.orders?.edges || []) {
        const order = edge.node;
        const codes: string[] = order.discountCodes || [];
        // Vérifier que le code correspond exactement (insensible à la casse)
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

  // Calcul des crédits qui auraient dû être gagnés (sans créditer le store credit)
  let remainder = totalRevenue;
  let creditsEarned = 0;
  while (remainder >= threshold) {
    creditsEarned += creditAmount;
    remainder -= threshold;
  }

  // Mise à jour des champs cache dans le metaobject
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
          { key: "cache_credit_earned", value: String(creditsEarned) },
          { key: "cache_ca_remainder", value: String(remainder) },
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
    creditsEarned,
    remainder,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};
