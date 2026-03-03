// FICHIER : app/routes/app.api.recalculate-stats.tsx
// Endpoint pour pré-calculer les stats de TOUS les pros en une seule passe
// Utilisé par RecalculateCacheModal (Phase 1) pour éviter N requêtes Shopify redondantes
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";
import { queryOrderStatsByCodeBatches } from "../lib/orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const allEntriesResult = await getMetaobjectEntries(admin);
  const allCodes = [...new Set<string>(
    allEntriesResult.entries
      .map((e: any) => e.code?.toUpperCase())
      .filter(Boolean),
  )];

  if (allCodes.length === 0) {
    return new Response(JSON.stringify({ success: true, stats: {} }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const statsMap = await queryOrderStatsByCodeBatches(admin, allCodes);
    const stats: Record<string, { revenue: number; count: number }> = {};
    for (const [code, data] of statsMap.entries()) {
      stats[code] = data;
    }
    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[recalculate-stats] Erreur:", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
