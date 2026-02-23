import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createMetaobjectEntry } from "../lib/metaobject.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const identification = String(formData.get("identification"));
  const first_name = String(formData.get("first_name") || "");
  const last_name = String(formData.get("last_name") || "");
  const email = String(formData.get("email") || "");
  const code = String(formData.get("code") || "");
  const montant = parseFloat(String(formData.get("montant") || "0"));
  const type = String(formData.get("type") || "%");
  const profession = String(formData.get("profession") || "");
  const adresse = String(formData.get("adresse") || "");

  const result = await createMetaobjectEntry(admin, {
    identification,
    first_name,
    last_name,
    email,
    code,
    montant,
    type,
    profession,
    adresse,
  });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};
