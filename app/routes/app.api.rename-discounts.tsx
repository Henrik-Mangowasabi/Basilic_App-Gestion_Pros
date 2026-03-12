import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";
import { updateShopifyDiscount } from "../lib/discount.server";

const CONCURRENCY = 5;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ phase: "fetching", message: "Récupération des pros..." });
        const allEntriesResult = await getMetaobjectEntries(admin);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = allEntriesResult.entries.filter((e: any) => e.discount_id && e.code);
        const total = entries.length;

        if (total === 0) {
          send({ done: true, updated: 0, total: 0, errors: [] });
          controller.close();
          return;
        }

        send({ phase: "updating", progress: 0, total });
        const errors: string[] = [];
        let updated = 0;

        for (let i = 0; i < entries.length; i += CONCURRENCY) {
          const chunk = entries.slice(i, i + CONCURRENCY);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await Promise.all(chunk.map(async (entry: any) => {
            const firstName = (entry.first_name || "").trim();
            const lastName = (entry.last_name || "").trim();
            const fullName = `${firstName} ${lastName}`.trim();
            const discountName = `Code promo Pro Sante - ${fullName} - ${entry.code}`;

            const result = await updateShopifyDiscount(admin, entry.discount_id, {
              code: entry.code,
              montant: parseFloat(entry.montant) || 0,
              type: entry.type || "%",
              name: discountName,
            });

            if (result.success) {
              updated++;
            } else {
              const name = fullName || "?";
              errors.push(`${name} (${entry.code}): ${result.error}`);
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
