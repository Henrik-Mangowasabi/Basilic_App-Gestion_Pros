import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { timingSafeEqual } from "crypto";
import { unauthenticated } from "../shopify.server";

// GET : test de connectivité Klaviyo
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response(JSON.stringify({ message: "Klaviyo webhook endpoint", method: "Use POST" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function verifySecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);

  // Sécurité : secret partagé dans l'URL (?secret=...)
  const providedSecret = url.searchParams.get("secret") || "";
  const expectedSecret = process.env.KLAVIYO_WEBHOOK_SECRET || "";
  if (!verifySecret(providedSecret, expectedSecret)) {
    console.warn("Klaviyo webhook: secret invalide");
    return new Response("Unauthorized", { status: 401 });
  }

  // Shop cible (?shop=myshop.myshopify.com ou env DEFAULT_SHOP_DOMAIN)
  const shop = url.searchParams.get("shop") || process.env.DEFAULT_SHOP_DOMAIN || "";
  if (!shop) {
    console.error("Klaviyo webhook: shop manquant");
    return new Response("Missing shop", { status: 400 });
  }

  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Klaviyo Flow webhook — l'email peut être à différents endroits selon la config du flow
  const email =
    (payload?.email as string) ||
    (payload?.["$email"] as string) ||
    ((payload?.data as any)?.attributes?.email as string) ||
    ((payload?.properties as any)?.email as string) ||
    ((payload?.profile as any)?.email as string);

  if (!email) {
    console.error("Klaviyo webhook: aucun email dans le payload", JSON.stringify(payload));
    return new Response("No email found", { status: 400 });
  }

  // Champs optionnels du profil Klaviyo
  const firstName = (payload?.first_name || payload?.["$first_name"] || "") as string;
  const lastName = (payload?.last_name || payload?.["$last_name"] || "") as string;
  const profession = (payload?.Profession || payload?.profession || "") as string;
  const adresse = (payload?.Adresse || payload?.adresse || payload?.address || "") as string;

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Cherche le client par email
    const customerResp = await admin.graphql(`#graphql
      query FindCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
            }
          }
        }
      }
    `, { variables: { query: `email:${email}` } });

    const customerData = await customerResp.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const customer = customerData.data?.customers?.edges?.[0]?.node;

    if (!customer) {
      // Crée le client dans Shopify
      const metafields: Array<{ namespace: string; key: string; value: string; type: string }> = [
        { namespace: "custom", key: "pro_en_attente_de_validation", value: "en_attente", type: "single_line_text_field" },
      ];
      if (profession) metafields.push({ namespace: "custom", key: "profession", value: profession, type: "single_line_text_field" });
      if (adresse) metafields.push({ namespace: "custom", key: "adresse", value: adresse, type: "single_line_text_field" });

      const createInput: Record<string, unknown> = { email, tags: ["pro_pending"], metafields };
      if (firstName) createInput.firstName = firstName;
      if (lastName) createInput.lastName = lastName;

      const createResp = await admin.graphql(`#graphql
        mutation CreateCustomerPending($input: CustomerInput!) {
          customerCreate(input: $input) {
            customer { id email }
            userErrors { field message }
          }
        }
      `, { variables: { input: createInput } });

      const createData = await createResp.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const createErrors = createData.data?.customerCreate?.userErrors;
      if (createErrors?.length > 0) {
        console.error("Klaviyo webhook: erreur création client", createErrors);
        return new Response("Error creating customer", { status: 500 });
      }

      console.log(`✅ Klaviyo webhook: client créé pour ${email}`);
      return new Response("OK", { status: 200 });
    }

    // Client existant — met à jour les metafields
    const metafields: Array<{ namespace: string; key: string; value: string; type: string }> = [
      { namespace: "custom", key: "pro_en_attente_de_validation", value: "en_attente", type: "single_line_text_field" },
    ];
    if (profession) metafields.push({ namespace: "custom", key: "profession", value: profession, type: "single_line_text_field" });
    if (adresse) metafields.push({ namespace: "custom", key: "adresse", value: adresse, type: "single_line_text_field" });

    const customerInput: Record<string, unknown> = { id: customer.id, metafields };
    if (firstName && !customer.firstName) customerInput.firstName = firstName;
    if (lastName && !customer.lastName) customerInput.lastName = lastName;

    const updateResp = await admin.graphql(`#graphql
      mutation UpdateCustomerPending($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id email }
          userErrors { field message }
        }
      }
    `, { variables: { input: customerInput } });

    const updateData = await updateResp.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const errors = updateData.data?.customerUpdate?.userErrors;
    if (errors?.length > 0) {
      console.error("Klaviyo webhook: erreur mise à jour client", errors);
      return new Response("Error updating customer", { status: 500 });
    }

    // Ajoute le tag pro_pending pour recherche instantanée
    await admin.graphql(`#graphql
      mutation TagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node { id }
          userErrors { field message }
        }
      }
    `, { variables: { id: customer.id, tags: ["pro_pending"] } });

    console.log(`✅ Klaviyo webhook: pro_en_attente_de_validation + tag définis pour ${email}`);
    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Klaviyo webhook: erreur interne", e);
    return new Response("Internal server error", { status: 500 });
  }
};
