import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { timingSafeStringEqual } from "../lib/security.server";

// Vérifie le mot de passe du mode édition côté serveur.
// ADMIN_PASSWORD ne doit jamais être envoyé au navigateur.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const password = String(formData.get("password") || "");
  // eslint-disable-next-line no-undef
  const expected = process.env.ADMIN_PASSWORD || "GestionPro";

  const valid = timingSafeStringEqual(password, expected);

  return new Response(JSON.stringify({ valid }), {
    headers: { "Content-Type": "application/json" },
  });
};
