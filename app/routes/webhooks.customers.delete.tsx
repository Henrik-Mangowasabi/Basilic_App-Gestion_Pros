import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, deleteMetaobjectEntry } from "../lib/metaobject.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  console.log(`[WEBHOOK] ${topic} reçu pour ${shop}`);

  if (!admin) {
    console.error("[WEBHOOK] customers/delete: pas d'admin context");
    return new Response();
  }

  const customerId = `gid://shopify/Customer/${(payload as any).id}`;
  console.log(`[WEBHOOK] customers/delete: suppression client ${customerId}`);

  try {
    // Chercher l'entrée metaobject avec ce customer_id
    const { entries } = await getMetaobjectEntries(admin);
    const entry = entries.find((e: any) => e.customer_id === customerId);

    if (!entry) {
      console.log(`[WEBHOOK] customers/delete: aucun metaobject trouvé pour ${customerId}`);
      return new Response();
    }

    console.log(`[WEBHOOK] customers/delete: suppression metaobject ${entry.id} (code: ${entry.code})`);
    const result = await deleteMetaobjectEntry(admin, entry.id);

    if (result.success) {
      console.log(`✅ [WEBHOOK] customers/delete: metaobject + discount supprimés pour ${customerId}`);
    } else {
      console.error(`❌ [WEBHOOK] customers/delete: erreur suppression`, result.error);
    }
  } catch (e) {
    console.error(`[WEBHOOK] customers/delete: exception`, e);
  }

  return new Response();
};
