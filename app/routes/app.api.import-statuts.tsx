import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, updateMetaobjectFields } from "../lib/metaobject.server";
import { syncRemunerationTag } from "../lib/customer.server";

const CONCURRENCY = 10;
const VALID_STATUTS = new Set(["illimite", "limite_annee", "sans_remuneration"]);

/**
 * Import des statuts de rémunération UNIQUEMENT (qualification loi anti-cadeaux en masse).
 *
 * Reçoit une liste { code, statut } (JSON), matche par code promo, et ne modifie QUE
 * remuneration_type (+ tag client, + nettoyage des dates de blocage si on quitte
 * limite_annee). Ne touche jamais : codes, montants, discounts, CA, crédits, accumulateurs.
 * SSE pour la progression.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  let items: { code: string; statut: string }[] = [];
  try {
    items = JSON.parse((formData.get("items") as string) || "[]");
  } catch {
    return new Response(JSON.stringify({ error: "items JSON invalide" }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ phase: "fetching", message: "Chargement des pros..." });
        const { entries } = await getMetaobjectEntries(admin);
        const byCode = new Map<string, any>();
        for (const e of entries as any[]) {
          if (e.code) byCode.set(e.code.toUpperCase(), e);
        }

        // Préparer la liste des changements réels
        const notFound: string[] = [];
        const invalid: string[] = [];
        let alreadyOk = 0;
        const toApply: { entry: any; target: string }[] = [];

        for (const item of items) {
          const code = String(item.code || "").trim().toUpperCase();
          const target = String(item.statut || "").trim();
          if (!code) continue;
          if (!VALID_STATUTS.has(target)) {
            invalid.push(`${code}: statut "${item.statut}" invalide`);
            continue;
          }
          const entry = byCode.get(code);
          if (!entry) {
            notFound.push(code);
            continue;
          }
          const current = entry.remuneration_type || "illimite";
          if (current === target) {
            alreadyOk++;
          } else {
            toApply.push({ entry, target });
          }
        }

        const total = toApply.length;
        send({ phase: "updating", progress: 0, total, alreadyOk, notFound: notFound.length });

        let updated = 0;
        const errors: string[] = [];

        for (let i = 0; i < toApply.length; i += CONCURRENCY) {
          const chunk = toApply.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map(async ({ entry, target }) => {
            const nom = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.code;
            try {
              const fields: { key: string; value: string }[] = [
                { key: "remuneration_type", value: target },
              ];
              // En quittant limite_annee, les dates de blocage n'ont plus de sens
              if (target !== "limite_annee") {
                fields.push({ key: "limitation_date", value: "" });
                fields.push({ key: "limitation_unlock_date", value: "" });
              }
              const result = await updateMetaobjectFields(admin, entry.id, fields);
              if (!result.success) {
                errors.push(`${nom}: ${result.error}`);
                return;
              }
              if (entry.customer_id) {
                try {
                  await syncRemunerationTag(admin, entry.customer_id, target);
                } catch { /* tag non-bloquant */ }
              }
              updated++;
            } catch (e) {
              errors.push(`${nom}: ${String(e)}`);
            }
          }));
          send({ phase: "updating", progress: Math.min(i + CONCURRENCY, total), total });
        }

        send({ done: true, updated, alreadyOk, notFound, invalid, errors, total });
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
