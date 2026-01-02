// FICHIER : app/lib/customer.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const PRO_TAG = "pro_sante";

function cleanEmail(email: string) {
  return email ? email.trim().toLowerCase() : "";
}

// Pour ta liste (Filtrage manuel pour éviter la liste vide)
export async function getProSanteCustomers(admin: AdminApiContext) {
  let allCustomers: any[] = [];
  let hasNextPage = true;
  let endCursor = null;

  console.log("🔍 [DEBUG] Démarrage recherche clients...");

  // 1. On essaie une requête SANS le filtre 'query' d'abord pour voir si on a accès AUX clients tout court
  // (Ceci est un test de diagnostic)
  /*
  try {
     const testQuery = `query { customers(first: 5) { edges { node { id, email, tags } } } }`;
     const r = await admin.graphql(testQuery);
     const d = await r.json() as any;
     console.log("🔍 [DEBUG] Test accès clients bruts :", JSON.stringify(d.data?.customers?.edges));
  } catch(e) { console.error("🔍 [DEBUG] Erreur accès brut :", e); }
  */

  // 2. La vraie boucle
  while (hasNextPage) {
    // Note : j'ai mis "query" entre guillemets doubles et échappé pour être sûr
    const query = `
      query($after: String) {
        customers(first: 250, after: $after, query: "tag:${PRO_TAG}") {
          pageInfo { hasNextPage, endCursor }
          edges {
            node {
              id
              firstName
              lastName
              email
              tags
              totalSpent
              ordersCount
              currencyCode
            }
          }
        }
      }
    `;

    try {
      const response = await admin.graphql(query, { variables: { after: endCursor } });
      const data = await response.json() as any;
      
      // LOGS IMPORTANTS
      if (data.errors) {
          console.error("❌ [DEBUG] Erreurs GraphQL retournées :", JSON.stringify(data.errors));
      }
      
      const newCustomers = data.data?.customers?.edges?.map((e: any) => e.node) || [];
      console.log(`🔍 [DEBUG] Page trouvée : ${newCustomers.length} clients.`);
      
      if (newCustomers.length > 0) {
          console.log(`🔍 [DEBUG] Exemple client trouvé : ${newCustomers[0].email} avec tags [${newCustomers[0].tags}]`);
      }

      allCustomers = [...allCustomers, ...newCustomers];
      hasNextPage = data.data?.customers?.pageInfo?.hasNextPage;
      endCursor = data.data?.customers?.pageInfo?.endCursor;

    } catch (error) {
      console.error("❌ [DEBUG] Exception boucle clients :", error);
      hasNextPage = false;
    }
  }

  console.log(`✅ [DEBUG] Total final retourné : ${allCustomers.length}`);
  return allCustomers;
}

export async function ensureCustomerPro(admin: AdminApiContext, rawEmail: string, name: string) {
  const email = cleanEmail(rawEmail);
  console.log(`[CUSTOMER] Vérification pour : ${email}`);

  // 1. Recherche Client Existant
  const searchQuery = `query { customers(first: 1, query: "email:${email}") { edges { node { id, tags } } } }`;
  let customerId = null;
  let currentTags: string[] = [];

  try {
    const response = await admin.graphql(searchQuery);
    const data = await response.json() as any;
    const existing = data.data?.customers?.edges?.[0]?.node;
    
    if (existing) {
      console.log(`[CUSTOMER] Trouvé existant : ${existing.id}`);
      customerId = existing.id;
      currentTags = existing.tags || [];
    }
  } catch (e) { console.error("Erreur recherche:", e); }

  // 2. Création si n'existe pas
  if (!customerId) {
    console.log(`[CUSTOMER] Inconnu. Création en cours...`);
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
      if (d.data?.customerCreate?.userErrors?.length > 0) {
          console.error("[CUSTOMER] Erreur création:", d.data.customerCreate.userErrors);
          return { success: false, error: d.data.customerCreate.userErrors[0].message };
      }
      customerId = d.data?.customerCreate?.customer?.id;
      console.log(`[CUSTOMER] Créé avec succès : ${customerId}`);
    } catch (e) { return { success: false, error: String(e) }; }
  } 
  // 3. Ajout Tag si existe déjà
  else if (!currentTags.includes(PRO_TAG)) {
      console.log(`[CUSTOMER] Ajout du tag...`);
      const tagsAddMutation = `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
      await admin.graphql(tagsAddMutation, { variables: { id: customerId, tags: [PRO_TAG] } });
  }

  // C'EST ICI QUE TOUT SE JOUE : ON RENVOIE L'ID
  return { success: true, customerId: customerId };
}

export async function removeCustomerProTag(admin: AdminApiContext, idOrEmail: string) {
    // Cette fonction essaie intelligemment de trouver le client
    let customerId = idOrEmail.startsWith("gid://") ? idOrEmail : null;

    if (!customerId) {
        // Fallback email
        const email = cleanEmail(idOrEmail);
        const q = `query { customers(first: 1, query: "email:${email}") { edges { node { id } } } }`;
        const r = await admin.graphql(q);
        const d = await r.json() as any;
        customerId = d.data?.customers?.edges?.[0]?.node?.id;
    }

    if (!customerId) return { success: true }; // Rien à faire

    const m = `mutation tagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;
    await admin.graphql(m, { variables: { id: customerId, tags: [PRO_TAG] } });
    return { success: true };
}

export async function updateCustomerEmailInShopify(admin: AdminApiContext, customerId: string, newEmail: string, newName?: string) {
    const input: any = { id: customerId, email: newEmail };
    if (newName) {
        const p = newName.split(" ");
        input.firstName = p[0];
        input.lastName = p.slice(1).join(" ") || p[0];
    }
    const m = `mutation customerUpdate($input: CustomerInput!) { customerUpdate(input: $input) { userErrors { field message } } }`;
    try {
        const r = await admin.graphql(m, { variables: { input } });
        const d = await r.json() as any;
        if (d.data?.customerUpdate?.userErrors?.length > 0) return { success: false, error: d.data.customerUpdate.userErrors[0].message };
        return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
}