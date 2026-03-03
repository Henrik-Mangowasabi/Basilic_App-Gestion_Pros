// FICHIER : app/lib/orders.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { updateCustomerProMetafields } from "./customer.server";

const BATCH_SIZE = 50;
const MAX_PAGES_PER_BATCH = 10; // 2 500 commandes max par lot

const ORDERS_BATCH_QUERY = `#graphql
  query GetOrdersBatch($qs: String!, $cursor: String) {
    orders(first: 250, query: $qs, after: $cursor) {
      edges {
        node {
          subtotalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          totalRefundedShippingSet { shopMoney { amount } }
          discountCodes
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Interroge les commandes Shopify par lots de 50 codes.
 * Retourne un Map<CODE_UPPER, {revenue, count}> pour tous les codes fournis.
 *
 * Évite la limite de longueur de requête OR avec de nombreux codes (2 000+).
 * Chaque lot génère une requête OR courte (~50 codes, ~1 500 chars).
 */
// Exclure commandes annulées, remboursées intégralement, paiements annulés
const DEFAULT_STATUS_FILTER = "-financial_status:refunded -financial_status:voided -status:cancelled";

export async function queryOrderStatsByCodeBatches(
  admin: AdminApiContext,
  codes: string[],
  extraFilter?: string,
  maxPagesPerBatch = MAX_PAGES_PER_BATCH,
): Promise<Map<string, { revenue: number; count: number }>> {
  const statsMap = new Map<string, { revenue: number; count: number }>();
  if (codes.length === 0) return statsMap;

  const baseFilter = extraFilter
    ? `${DEFAULT_STATUS_FILTER} ${extraFilter}`
    : DEFAULT_STATUS_FILTER;

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE);
    const batchSet = new Set(batch);
    const codeFilter = batch.map((c: string) => `discount_code:${c}`).join(" OR ");
    const qs = `${baseFilter} AND (${codeFilter})`;

    let hasMore = true;
    let cursor: string | null = null;
    let pages = 0;

    while (hasMore && pages < maxPagesPerBatch) {
      try {
        const resp = await (admin as any).graphql(ORDERS_BATCH_QUERY, { variables: { qs, cursor } });
        const data = await resp.json() as any;

        for (const edge of data.data?.orders?.edges || []) {
          const order = edge.node;
          const subtotal = parseFloat(order.subtotalPriceSet?.shopMoney?.amount || "0");
          const totalRefunded = parseFloat(order.totalRefundedSet?.shopMoney?.amount || "0");
          const shippingRefunded = parseFloat(order.totalRefundedShippingSet?.shopMoney?.amount || "0");
          // Soustraire uniquement les remboursements produits (pas shipping)
          const productRefunded = Math.max(0, totalRefunded - shippingRefunded);
          const revenue = Math.max(0, subtotal - productRefunded);
          for (const code of order.discountCodes || []) {
            const upper = code.toUpperCase();
            if (batchSet.has(upper)) {
              const cur = statsMap.get(upper) || { revenue: 0, count: 0 };
              statsMap.set(upper, { revenue: cur.revenue + revenue, count: cur.count + 1 });
            }
          }
        }

        hasMore = data.data?.orders?.pageInfo?.hasNextPage ?? false;
        cursor = data.data?.orders?.pageInfo?.endCursor ?? null;
        pages++;
      } catch (e) {
        console.error(`[ORDERS BATCH] Erreur lot ${Math.floor(i / BATCH_SIZE) + 1}:`, e);
        break;
      }
    }
  }

  return statsMap;
}

const METAOBJECT_TYPE = "mm_pro_de_sante";

/**
 * Recalcule le cache CA d'un pro à partir de son code promo.
 * Utilisé par les webhooks orders/cancelled et refunds/create.
 * Met à jour cache_revenue + cache_orders_count du MO, et ca_genere du client.
 */
export async function recalculateProCache(
  admin: AdminApiContext,
  discountCode: string,
): Promise<{ success: boolean; error?: string }> {
  const codeUpper = discountCode.toUpperCase();
  console.log(`[RECALC] Recalcul cache pour code: ${codeUpper}`);

  // 1. Trouver le pro par son code
  const searchQuery = `query { metaobjects(first: 250, type: "${METAOBJECT_TYPE}") { edges { node { id fields { key value } } } } }`;
  let metaobjectId: string | null = null;
  let customerId: string | null = null;
  let allCodes: string[] = [];

  try {
    let hasMore = true;
    let cursor: string | null = null;
    const allEntries: any[] = [];

    while (hasMore) {
      const cursorParam = cursor ? `, after: "${cursor}"` : "";
      const q = `query { metaobjects(first: 250, type: "${METAOBJECT_TYPE}"${cursorParam}) { edges { node { id fields { key value } } } pageInfo { hasNextPage endCursor } } }`;
      const r = await admin.graphql(q);
      const d = (await r.json()) as any;
      for (const edge of d.data?.metaobjects?.edges || []) {
        allEntries.push(edge.node);
      }
      hasMore = d.data?.metaobjects?.pageInfo?.hasNextPage ?? false;
      cursor = d.data?.metaobjects?.pageInfo?.endCursor ?? null;
    }

    for (const entry of allEntries) {
      const fields: Record<string, string> = {};
      for (const f of entry.fields || []) fields[f.key] = f.value || "";
      const entryCode = (fields.code || "").toUpperCase();
      if (entryCode) allCodes.push(entryCode);
      if (entryCode === codeUpper) {
        metaobjectId = entry.id;
        customerId = fields.customer_id || null;
      }
    }
  } catch (e) {
    console.error("[RECALC] Erreur recherche pro:", e);
    return { success: false, error: String(e) };
  }

  if (!metaobjectId) {
    console.log(`[RECALC] Aucun pro trouvé pour code ${codeUpper}`);
    return { success: true };
  }

  // 2. Recalculer le CA avec tous les codes (OR query pour résultats complets)
  try {
    const statsMap = await queryOrderStatsByCodeBatches(admin, allCodes);
    const stats = statsMap.get(codeUpper);
    const totalRevenue = stats?.revenue ?? 0;
    const totalOrders = stats?.count ?? 0;

    console.log(`[RECALC] ${codeUpper}: revenue=${totalRevenue}, orders=${totalOrders}`);

    // 3. Mettre à jour le MO
    await admin.graphql(`mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`, {
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

    // 4. Mettre à jour ca_genere sur le client (non-bloquant)
    if (customerId) {
      try {
        await updateCustomerProMetafields(admin, customerId, { ca_genere: totalRevenue });
      } catch (mfErr) {
        console.warn("[RECALC] Echec ca_genere (non-bloquant):", mfErr);
      }
    }

    return { success: true };
  } catch (e) {
    console.error("[RECALC] Erreur recalcul:", e);
    return { success: false, error: String(e) };
  }
}
