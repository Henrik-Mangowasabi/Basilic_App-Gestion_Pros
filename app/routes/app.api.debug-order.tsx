import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const names = url.searchParams.getAll("name"); // ?name=JM203098&name=JM205823...

  if (names.length === 0) {
    return Response.json({ error: "Paramètre ?name= requis" }, { status: 400 });
  }

  const nameQuery = names.map((n) => `name:${n}`).join(" OR ");

  const QUERY = `#graphql
    query DebugOrders($qs: String!) {
      orders(first: 10, query: $qs) {
        edges {
          node {
            name
            createdAt
            discountCodes
            discountApplications(first: 10) {
              edges {
                node {
                  __typename
                  allocationMethod
                  targetSelection
                  targetType
                  ... on DiscountCodeApplication {
                    code
                    applicable
                  }
                  ... on AutomaticDiscountApplication {
                    title
                  }
                  ... on ManualDiscountApplication {
                    title
                    description
                  }
                  ... on ScriptDiscountApplication {
                    title
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const resp = await (admin as any).graphql(QUERY, { variables: { qs: nameQuery } });
  const data = await resp.json() as any;

  const orders = (data.data?.orders?.edges || []).map((e: any) => {
    const o = e.node;
    console.log(`[DEBUG ORDER] ${o.name} (${o.createdAt})`);
    console.log(`  discountCodes: ${JSON.stringify(o.discountCodes)}`);
    for (const app of o.discountApplications?.edges || []) {
      console.log(`  discountApplication: ${JSON.stringify(app.node)}`);
    }
    return {
      name: o.name,
      createdAt: o.createdAt,
      discountCodes: o.discountCodes,
      discountApplications: o.discountApplications?.edges?.map((a: any) => a.node),
    };
  });

  return Response.json({ orders });
};
