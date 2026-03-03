import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";
import { queryOrderStatsByCodeBatches } from "../lib/orders.server";
import { updateCustomerProMetafields } from "../lib/customer.server";

const CONCURRENCY = 10;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Phase 1 : récupérer tous les metaobjects
        send({ phase: "fetching", message: "Récupération des pros..." });
        const allEntriesResult = await getMetaobjectEntries(admin);
        const entries = allEntriesResult.entries.filter((e: any) => e.code);
        const total = entries.length;

        if (total === 0) {
          send({ done: true, updated: 0, total: 0, errors: [] });
          controller.close();
          return;
        }

        // Phase 2 : récupérer toutes les stats en une passe
        send({ phase: "fetching", message: "Calcul des statistiques..." });
        const allCodes = [...new Set<string>(
          entries.map((e: any) => e.code.toUpperCase()).filter(Boolean),
        )];
        const statsMap = await queryOrderStatsByCodeBatches(admin, allCodes);

        // Phase 3 : mettre à jour chaque pro (mutations serveur-side)
        send({ phase: "updating", progress: 0, total });
        const errors: string[] = [];
        let updated = 0;

        for (let i = 0; i < entries.length; i += CONCURRENCY) {
          const chunk = entries.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map(async (entry: any) => {
            const codeUpper = entry.code.toUpperCase();
            const stats = statsMap.get(codeUpper);
            const totalRevenue = stats?.revenue ?? 0;
            const totalOrders = stats?.count ?? 0;

            try {
              // Update MO cache
              const r = await admin.graphql(`#graphql
                mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
                  metaobjectUpdate(id: $id, metaobject: $metaobject) {
                    metaobject { id }
                    userErrors { field message }
                  }
                }
              `, {
                variables: {
                  id: entry.id,
                  metaobject: {
                    fields: [
                      { key: "cache_revenue", value: String(totalRevenue) },
                      { key: "cache_orders_count", value: String(totalOrders) },
                    ],
                  },
                },
              });
              const d = await r.json() as any;
              if (d.data?.metaobjectUpdate?.userErrors?.length > 0) {
                const name = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || "?";
                errors.push(`${name}: ${d.data.metaobjectUpdate.userErrors[0].message}`);
                return;
              }

              // Update customer metafield ca_genere
              if (entry.customer_id) {
                try {
                  await updateCustomerProMetafields(admin, entry.customer_id, { ca_genere: totalRevenue });
                } catch (mfErr) {
                  // Non-bloquant
                }
              }
              updated++;
            } catch (e) {
              const name = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || "?";
              errors.push(`${name}: ${String(e)}`);
            }
          }));

          const progress = Math.min(i + CONCURRENCY, entries.length);
          send({ phase: "updating", progress, total });
        }

        send({ done: true, updated, total, errors });
      } catch (e) {
        send({ error: String(e) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
};
