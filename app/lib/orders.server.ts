// FICHIER : app/lib/orders.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const BATCH_SIZE = 50;
const MAX_PAGES_PER_BATCH = 10; // 2 500 commandes max par lot

const ORDERS_BATCH_QUERY = `#graphql
  query GetOrdersBatch($qs: String!, $cursor: String) {
    orders(first: 250, query: $qs, after: $cursor) {
      edges {
        node {
          subtotalPriceSet { shopMoney { amount } }
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
export async function queryOrderStatsByCodeBatches(
  admin: AdminApiContext,
  codes: string[],
  extraFilter?: string,
  maxPagesPerBatch = MAX_PAGES_PER_BATCH,
): Promise<Map<string, { revenue: number; count: number }>> {
  const statsMap = new Map<string, { revenue: number; count: number }>();
  if (codes.length === 0) return statsMap;

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE);
    const batchSet = new Set(batch);
    const codeFilter = batch.map((c: string) => `discount_code:${c}`).join(" OR ");
    const qs = extraFilter ? `${extraFilter} AND (${codeFilter})` : `(${codeFilter})`;

    let hasMore = true;
    let cursor: string | null = null;
    let pages = 0;

    while (hasMore && pages < maxPagesPerBatch) {
      try {
        const resp = await (admin as any).graphql(ORDERS_BATCH_QUERY, { variables: { qs, cursor } });
        const data = await resp.json() as any;

        for (const edge of data.data?.orders?.edges || []) {
          const order = edge.node;
          const revenue = parseFloat(order.subtotalPriceSet?.shopMoney?.amount || "0");
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
