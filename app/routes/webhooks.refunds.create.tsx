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

  console.log(`[WEBHOOK] REFUNDS_CREATE reçu pour ${shop}`);

  // Le payload refund contient order_id → récupérer les discount codes de la commande
  const orderId = payload.order_id;
  if (!orderId) {
    console.log("[WEBHOOK] refunds/create: pas d'order_id → rien à recalculer");
    return new Response("OK", { status: 200 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Récupérer les discount codes de la commande via GraphQL
    const orderGid = `gid://shopify/Order/${orderId}`;
    const r = await admin.graphql(`query getOrder($id: ID!) { order(id: $id) { discountCodes } }`, {
      variables: { id: orderGid },
    });
    const d = (await r.json()) as any;
    const codes: string[] = d.data?.order?.discountCodes || [];

    if (codes.length === 0) {
      console.log("[WEBHOOK] refunds/create: commande sans code promo → rien à recalculer");
      return new Response("OK", { status: 200 });
    }

    // Recalculer le cache pour chaque code promo utilisé
    for (const code of codes) {
      console.log(`[WEBHOOK] refunds/create: code "${code}" → recalcul du cache`);
      await recalculateProCache(admin, code);
    }
  } catch (e) {
    console.error("[WEBHOOK] refunds/create erreur:", e);
  }

  return new Response("OK", { status: 200 });
};
