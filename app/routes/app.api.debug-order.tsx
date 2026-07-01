import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Mode 1: ?code=AF_ADSAINTHONORE → teste REST API vs GraphQL pour un code donné
  const code = url.searchParams.get("code");
  if (code) {
    console.log(`[DEBUG] Test REST API pour code: ${code}`);

    // REST API — stocke le code promo en texte brut sur la commande
    const restResp = await (admin as any).rest.get({
      path: "orders",
      query: {
        discount_code: code,
        status: "any",
        limit: 250,
        fields: "id,name,created_at,discount_codes,subtotal_price,financial_status,cancel_reason",
      },
    });
    const restData = await restResp.json() as any;
    const restOrders = restData.orders || [];

    console.log(`[DEBUG] REST API → ${restOrders.length} commandes trouvées pour ${code}`);
    for (const o of restOrders) {
      console.log(`  ${o.name} (${o.created_at?.slice(0, 10)}) discount_codes=${JSON.stringify(o.discount_codes)} subtotal=${o.subtotal_price} status=${o.financial_status}`);
    }

    // GraphQL pour comparaison
    const gqlResp = await (admin as any).graphql(`#graphql
      query { orders(first: 250, query: "discount_code:${code} -financial_status:refunded -financial_status:voided -status:cancelled") {
        edges { node { name createdAt discountCodes } }
      }}
    `);
    const gqlData = await gqlResp.json() as any;
    const gqlOrders = gqlData.data?.orders?.edges || [];
    console.log(`[DEBUG] GraphQL → ${gqlOrders.length} commandes trouvées pour ${code}`);

    return Response.json({
      code,
      rest_count: restOrders.length,
      graphql_count: gqlOrders.length,
      rest_orders: restOrders.map((o: any) => ({
        name: o.name,
        date: o.created_at?.slice(0, 10),
        discount_codes: o.discount_codes,
        subtotal_price: o.subtotal_price,
        financial_status: o.financial_status,
      })),
      graphql_orders: gqlOrders.map((e: any) => ({
        name: e.node.name,
        date: e.node.createdAt?.slice(0, 10),
        discountCodes: e.node.discountCodes,
      })),
    });
  }

  return Response.json({ error: "Paramètre ?code= requis" }, { status: 400 });
};
