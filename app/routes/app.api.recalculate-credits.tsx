import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { depositStoreCredit } from "../lib/customer.server";
import { updateMetaobjectFields } from "../lib/metaobject.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const metaobjectId = formData.get("metaobjectId") as string;
  const customerId = formData.get("customerId") as string | null;
  const creditsToDeposit = parseFloat(formData.get("creditsToDeposit") as string || "0");
  const newCreditEarned = parseFloat(formData.get("newCreditEarned") as string || "0");
  const newCaRemainder = parseFloat(formData.get("newCaRemainder") as string || "0");

  if (!metaobjectId) {
    return new Response(JSON.stringify({ error: "metaobjectId requis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let creditDeposited = false;

  // 1. Déposer store credit si besoin — si le virement échoue, on n'update PAS
  // les compteurs (sinon des crédits seraient marqués versés sans l'être)
  if (creditsToDeposit > 0 && customerId) {
    const deposit = await depositStoreCredit(admin, customerId, creditsToDeposit);
    if (!deposit.success) {
      return new Response(JSON.stringify({
        error: `Erreur dépôt store credit: ${deposit.error || "inconnue"}`,
      }), { headers: { "Content-Type": "application/json" } });
    }
    creditDeposited = true;
  }

  // 2. Mettre à jour le metaobject (cache_credit_earned + cache_ca_remainder)
  const updateResult = await updateMetaobjectFields(admin, metaobjectId, [
    { key: "cache_credit_earned", value: String(newCreditEarned) },
    { key: "cache_ca_remainder", value: String(newCaRemainder) },
  ]);
  if (!updateResult.success) {
    return new Response(JSON.stringify({
      error: "Erreur mise à jour metaobject",
      details: updateResult.error,
    }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ success: true, creditDeposited, creditsDeposited: creditsToDeposit }), {
    headers: { "Content-Type": "application/json" },
  });
};
