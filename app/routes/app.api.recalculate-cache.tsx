import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { updateCustomerProMetafields } from "../lib/customer.server";
import { updateMetaobjectFields } from "../lib/metaobject.server";
import { queryAllOrdersForCode } from "../lib/orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const metaobjectId = formData.get("metaobjectId") as string;
  const code = formData.get("code") as string;
  const customerId = formData.get("customerId") as string | null;
  const preRevenueStr = formData.get("preRevenue") as string | null;
  const preCountStr = formData.get("preCount") as string | null;
  const fromDate = formData.get("fromDate") as string | null;

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

      try {
        let restUrl = `https://${session.shop}/admin/api/2025-10/orders.json?discount_code=${encodeURIComponent(codeUpper)}&status=any&limit=250&fields=id,name,created_at,discount_codes,subtotal_price,current_subtotal_price,financial_status,cancel_reason,refunds`;
        if (fromDate) restUrl += `&created_at_min=${encodeURIComponent(fromDate + "T00:00:00")}`;

        // Pagination via Link header (rel="next") — un pro peut avoir >250 commandes
        let pageUrl: string | null = restUrl;
        let pagesFetched = 0;
        const MAX_REST_PAGES = 20; // 5 000 commandes max

        while (pageUrl && pagesFetched < MAX_REST_PAGES) {
          const restResp: Response = await fetch(pageUrl, {
            headers: {
              "X-Shopify-Access-Token": session.accessToken!,
              "Content-Type": "application/json",
            },
          });
          // fetch ne rejette pas sur un statut HTTP d'erreur (401, 429...) — sans ce check,
          // une réponse d'erreur donnerait 0 commandes et écraserait le cache à 0€
          if (!restResp.ok) {
            throw new Error(`REST API HTTP ${restResp.status}`);
          }
          const restData = await restResp.json() as any;
          const restOrders = restData.orders || [];
          console.log(`[REST API] ${codeUpper}: ${restOrders.length} commandes brutes (page ${pagesFetched + 1})`);

          for (const o of restOrders) {
            if (o.financial_status === "refunded" || o.financial_status === "voided" || o.cancel_reason) continue;
            // current_subtotal_price = sous-total après éditions de commande (articles supprimés exclus)
            const subtotal = parseFloat(o.current_subtotal_price ?? o.subtotal_price ?? "0");
            let productRefunded = 0;
            for (const refund of o.refunds || []) {
              for (const ri of refund.refund_line_items || []) {
                // subtotal + total_tax = montant produit TTC remboursé — même base que le
                // calcul GraphQL (totalRefunded − shipping), sinon les deux recalculs divergent
                productRefunded += parseFloat(ri.subtotal || "0") + parseFloat(ri.total_tax || "0");
              }
            }
            restRevenue += Math.max(0, subtotal - productRefunded);
            restCount++;
          }

          const linkHeader = restResp.headers.get("link") || "";
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          pageUrl = nextMatch ? nextMatch[1] : null;
          pagesFetched++;
        }

        if (pageUrl) {
          console.warn(`[REST API] ⚠ ${codeUpper}: limite de ${MAX_REST_PAGES * 250} commandes atteinte — résultats potentiellement incomplets.`);
        }

        console.log(`[REST API] Résultat: ${restCount} commandes valides, CA=${restRevenue.toFixed(2)}€`);
        restSuccess = true;
      } catch (restErr) {
        // restSuccess reste false → les compteurs partiels ne sont jamais lus,
        // le fallback GraphQL prend le relais
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
  const updateResult = await updateMetaobjectFields(admin, metaobjectId, [
    { key: "cache_revenue", value: String(totalRevenue) },
    { key: "cache_orders_count", value: String(totalOrders) },
  ]);
  if (!updateResult.success) {
    return new Response(JSON.stringify({
      error: "Erreur mise à jour metaobject",
      details: updateResult.error,
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
