// FICHIER : app/lib/customer.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const PRO_TAG = "pro_sante";

function cleanEmail(email: string) {
  return email ? email.trim().toLowerCase() : "";
}

export async function getProSanteCustomers(admin: AdminApiContext) {
  // ... (Code existant inchangé pour cette fonction)
  const query = `query { customers(first: 50, query: "tag:${PRO_TAG}", reverse: true) { edges { node { id, firstName, lastName, email, tags, totalSpent, ordersCount, currencyCode } } } }`;
  try {
    const response = await admin.graphql(query);
    const data = await response.json() as any;
    return data.data?.customers?.edges?.map((e: any) => e.node) || [];
  } catch (error) { return []; }
}

export async function ensureCustomerPro(admin: AdminApiContext, rawEmail: string, name: string) {
  const email = cleanEmail(rawEmail);
  const searchQuery = `query { customers(first: 1, query: "email:${email}") { edges { node { id, tags } } } }`;
  
  let customerId = null;
  let currentTags: string[] = [];

  try {
    const response = await admin.graphql(searchQuery);
    const data = await response.json() as any;
    const existing = data.data?.customers?.edges?.[0]?.node;
    if (existing) {
      customerId = existing.id;
      currentTags = existing.tags || [];
    }
  } catch (e) { console.error("Erreur recherche client:", e); }

  // Création
  if (!customerId) {
    const createMutation = `mutation customerCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { id }, userErrors { field message } } }`;
    const nameParts = name.split(" ");
    const variables = {
      input: {
        email: email,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || nameParts[0],
        tags: [PRO_TAG],
        emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" }
      }
    };
    try {
      const r = await admin.graphql(createMutation, { variables });
      const d = await r.json() as any;
      if (d.data?.customerCreate?.userErrors?.length > 0) return { success: false, error: d.data.customerCreate.userErrors[0].message };
      customerId = d.data?.customerCreate?.customer?.id; // On récupère l'ID créé
    } catch (e) { return { success: false, error: String(e) }; }
  } else {
    // Ajout tag si existant
    if (!currentTags.includes(PRO_TAG)) {
      const tagsAddMutation = `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
      await admin.graphql(tagsAddMutation, { variables: { id: customerId, tags: [PRO_TAG] } });
    }
  }

  // IMPORTANT : On renvoie l'ID du client pour le stocker !
  return { success: true, customerId: customerId };
}

export async function removeCustomerProTag(admin: AdminApiContext, customerId: string) {
  // Maintenant on prend directement l'ID, plus besoin de chercher par email !
  console.log(`[TAG REMOVE] Retrait tag pour ID : ${customerId}`);
  const tagsRemoveMutation = `mutation tagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;
  try {
    await admin.graphql(tagsRemoveMutation, { variables: { id: customerId, tags: [PRO_TAG] } });
    return { success: true };
  } catch (e) { return { success: false, error: String(e) }; }
}

export async function updateCustomerEmailInShopify(admin: AdminApiContext, customerId: string, newEmail: string, newName?: string) {
    console.log(`[CLIENT UPDATE] Update ID ${customerId} -> ${newEmail}`);
    const updateMutation = `mutation customerUpdate($input: CustomerInput!) { customerUpdate(input: $input) { userErrors { field message } } }`;
    
    const input: any = { id: customerId, email: newEmail };
    if (newName) {
        const parts = newName.split(" ");
        input.firstName = parts[0];
        input.lastName = parts.slice(1).join(" ") || parts[0];
    }

    try {
      const res = await admin.graphql(updateMutation, { variables: { input } });
      const json = await res.json() as any;
      if (json.data?.customerUpdate?.userErrors?.length > 0) return { success: false, error: json.data.customerUpdate.userErrors[0].message };
      return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
}