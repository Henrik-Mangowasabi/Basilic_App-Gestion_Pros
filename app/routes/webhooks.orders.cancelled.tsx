import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { unauthenticated } from "../shopify.server";
import { recalculateProCache } from "../lib/orders.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("OK", { status: 200 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // Validation HMAC
  const secret = process.env.SHOPIFY_API_SECRET?.trim() || "";
  const computedHmac = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const trusted = Buffer.from(computedHmac);
    const received = Buffer.from(hmacHeader);
    if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
      return new Response("OK", { status: 200 });
    }
  } catch {
    return new Response("OK", { status: 200 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("OK", { status: 200 });
  }

  console.log(`[WEBHOOK] ORDERS_CANCELLED reçu pour ${shop}`);

  // Extraire le code promo de la commande annulée
  const discountCodes = payload.discount_codes || [];
  const usedCode = discountCodes.length > 0 ? discountCodes[0].code : null;

  if (!usedCode) {
    console.log("[WEBHOOK] orders/cancelled: pas de code promo → rien à recalculer");
    return new Response("OK", { status: 200 });
  }

  console.log(`[WEBHOOK] orders/cancelled: code promo "${usedCode}" → recalcul du cache`);

  try {
    const { admin } = await unauthenticated.admin(shop);
    await recalculateProCache(admin, usedCode);
  } catch (e) {
    console.error("[WEBHOOK] orders/cancelled erreur recalcul:", e);
  }

  return new Response("OK", { status: 200 });
};
