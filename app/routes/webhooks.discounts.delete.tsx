import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, updateMetaobjectFields } from "../lib/metaobject.server";
import { findDiscountIdByCode, codesBeingRecreated } from "../lib/discount.server";
import {
  removeCustomerProTag,
  deleteCustomerCodePromo,
} from "../lib/customer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  console.log(`[WEBHOOK] ${topic} reçu pour ${shop}`);

  if (!admin) {
    console.error("[WEBHOOK] discounts/delete: pas d'admin context");
    return new Response();
  }

  // Le payload contient l'ID numérique du discount supprimé
  const discountNumericId = String((payload as any).id);
  console.log(`[WEBHOOK] discounts/delete: discount supprimé id=${discountNumericId}`);

  try {
    const { entries } = await getMetaobjectEntries(admin);

    // Le discount_id est stocké en GID : "gid://shopify/DiscountCodeNode/123456"
    const entry = entries.find((e: any) => {
      const stored = e.discount_id || "";
      return stored.endsWith(`/${discountNumericId}`);
    });

    if (!entry) {
      console.log(`[WEBHOOK] discounts/delete: aucun pro trouvé pour discount ${discountNumericId}`);
      return new Response();
    }

    // GARDE-FOU : si la suppression vient du flow delete+recreate de l'app
    // (code déjà pris à l'import, réparation d'un discount), NE PAS supprimer le pro.
    const entryCodeUpper = (entry.code || "").toUpperCase();
    if (entryCodeUpper && codesBeingRecreated.has(entryCodeUpper)) {
      console.log(`[WEBHOOK] discounts/delete: recréation en cours pour "${entry.code}" → pro conservé`);
      return new Response();
    }

    // Vérifier si un discount avec le même code existe à nouveau (recréé par l'app
    // ou manuellement) → resynchroniser le discount_id au lieu de supprimer le pro
    if (entryCodeUpper) {
      const recreatedId = await findDiscountIdByCode(admin, entry.code);
      if (recreatedId) {
        console.log(`[WEBHOOK] discounts/delete: discount "${entry.code}" existe à nouveau (${recreatedId}) → resync discount_id, pro conservé`);
        if (recreatedId !== entry.discount_id) {
          const syncResult = await updateMetaobjectFields(admin, entry.id, [
            { key: "discount_id", value: recreatedId },
          ]);
          if (!syncResult.success) {
            console.error(`[WEBHOOK] discounts/delete: échec resync discount_id pour ${entry.code} — le pro garde un discount_id mort:`, syncResult.error);
          }
        }
        return new Response();
      }
    }

    console.log(`[WEBHOOK] discounts/delete: suppression pro ${entry.id} (code: ${entry.code})`);

    // Supprimer le tag + metafield du client (non-bloquant)
    if (entry.customer_id) {
      try {
        await removeCustomerProTag(admin, entry.customer_id);
      } catch (tagErr) {
        console.warn("[WEBHOOK] discounts/delete: erreur tag client (non-bloquant)", tagErr);
      }
      try {
        await deleteCustomerCodePromo(admin, entry.customer_id);
      } catch (mfErr) {
        console.warn("[WEBHOOK] discounts/delete: erreur metafield (non-bloquant)", mfErr);
      }
    }

    // Supprimer le metaobject directement (le discount est déjà supprimé)
    const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { userErrors { field message } } }`;
    await admin.graphql(mutation, { variables: { id: entry.id } });

    console.log(`✅ [WEBHOOK] discounts/delete: pro supprimé pour discount ${discountNumericId}`);
  } catch (e) {
    console.error(`[WEBHOOK] discounts/delete: exception`, e);
  }

  return new Response();
};
