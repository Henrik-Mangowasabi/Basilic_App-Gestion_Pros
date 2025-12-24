import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: Implémenter la suppression des sessions quand la base de données sera configurée
  if (session) {
    console.log(`Would delete sessions for shop: ${shop}`);
  }

  return new Response();
};
