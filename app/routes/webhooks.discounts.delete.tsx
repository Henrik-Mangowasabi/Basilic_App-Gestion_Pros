import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";
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
