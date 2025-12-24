import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // TODO: Implémenter la mise à jour des scopes quand la base de données sera configurée
    const current = payload.current as string[];
    if (session) {
        console.log(`Would update scope for session ${session.id} to: ${current.toString()}`);
    }
    return new Response();
};
