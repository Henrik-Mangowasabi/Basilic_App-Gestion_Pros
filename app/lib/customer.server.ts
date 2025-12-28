// FICHIER : app/lib/customer.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const PRO_TAG = "pro_sante";

// --- HELPERS ---
// Fonction pour nettoyer les emails et éviter les erreurs de recherche
function cleanEmail(email: string) {
  return email ? email.trim().toLowerCase() : "";
}

export async function getProSanteCustomers(admin: AdminApiContext) {
  const query = `
    query {
      customers(first: 50, query: "tag:${PRO_TAG}", reverse: true) {
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
    const response = await admin.graphql(query);
    const data = await response.json() as any;
    return data.data?.customers?.edges?.map((e: any) => e.node) || [];
  } catch (error) {
    console.error("Erreur fetch customers:", error);
    return [];
  }
}

export async function ensureCustomerPro(admin: AdminApiContext, rawEmail: string, name: string) {
  const email = cleanEmail(rawEmail);
  
  // 1. Chercher si le client existe (Recherche stricte)
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

  // 2. Création si inexistant
  if (!customerId) {
    const createMutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `;
    
    const nameParts = name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || nameParts[0]; 

    const variables = {
      input: {
        email: email,
        firstName: firstName,
        lastName: lastName,
        tags: [PRO_TAG],
        emailMarketingConsent: {
          marketingState: "SUBSCRIBED",
          marketingOptInLevel: "SINGLE_OPT_IN"
        }
      }
    };

    try {
      const r = await admin.graphql(createMutation, { variables });
      const d = await r.json() as any;
      if (d.data?.customerCreate?.userErrors?.length > 0) {
        return { success: false, error: d.data.customerCreate.userErrors[0].message };
      }
      return { success: true, action: "created" };
    } catch (e) { return { success: false, error: String(e) }; }
  }

  // 3. Ajout du tag si existant
  if (customerId && !currentTags.includes(PRO_TAG)) {
    const tagsAddMutation = `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
    try {
      await admin.graphql(tagsAddMutation, { variables: { id: customerId, tags: [PRO_TAG] } });
      return { success: true, action: "tagged" };
    } catch (e) { return { success: false, error: String(e) }; }
  }

  return { success: true, action: "already_tagged" };
}

// --- FONCTION DE SUPPRESSION DU TAG (CORRIGÉE) ---
export async function removeCustomerProTag(admin: AdminApiContext, rawEmail: string) {
  const email = cleanEmail(rawEmail);
  console.log(`[CLIENT TAG REMOVE] Recherche du client avec l'email : "${email}"`);

  // 1. Trouver l'ID
  const searchQuery = `query { customers(first: 1, query: "email:${email}") { edges { node { id, tags } } } }`;
  
  try {
    const r = await admin.graphql(searchQuery);
    const d = await r.json() as any;
    const customerNode = d.data?.customers?.edges?.[0]?.node;
    const customerId = customerNode?.id;

    if (!customerId) {
        console.warn(`[CLIENT TAG REMOVE] Client introuvable pour l'email "${email}". Le tag ne peut pas être retiré.`);
        return { success: true }; // On ne bloque pas la suppression de l'entrée pour autant
    }

    // Petite verif pour ne pas appeler l'API pour rien
    if (!customerNode.tags.includes(PRO_TAG)) {
        console.log(`[CLIENT TAG REMOVE] Le client existe mais n'a pas le tag. Rien à faire.`);
        return { success: true };
    }

    console.log(`[CLIENT TAG REMOVE] Client trouvé (${customerId}). Retrait du tag...`);

    // 2. Retirer le tag
    const tagsRemoveMutation = `
      mutation tagsRemove($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }
    `;

    const res = await admin.graphql(tagsRemoveMutation, { variables: { id: customerId, tags: [PRO_TAG] } });
    const json = await res.json() as any;
    
    if (json.data?.tagsRemove?.userErrors?.length > 0) {
        console.error("Erreur API Shopify lors du retrait du tag:", json.data.tagsRemove.userErrors);
        return { success: false, error: json.data.tagsRemove.userErrors[0].message };
    }

    console.log(`[CLIENT TAG REMOVE] Tag retiré avec succès.`);
    return { success: true };

  } catch (e) { 
      console.error("Exception lors du retrait du tag:", e);
      return { success: false, error: String(e) }; 
  }
}

export async function updateCustomerEmailInShopify(admin: AdminApiContext, oldEmail: string, newEmail: string, newName?: string) {
    const cleanOld = cleanEmail(oldEmail);
    const cleanNew = cleanEmail(newEmail);

    console.log(`[CLIENT UPDATE] Tentative de changement d'email : ${cleanOld} -> ${cleanNew}`);
    
    const searchQuery = `query { customers(first: 1, query: "email:${cleanOld}") { edges { node { id } } } }`;
    
    try {
      const r = await admin.graphql(searchQuery);
      const d = await r.json() as any;
      const customerId = d.data?.customers?.edges?.[0]?.node?.id;
  
      if (!customerId) {
          console.warn(`[CLIENT UPDATE] Ancien client introuvable. Création du nouveau...`);
          return await ensureCustomerPro(admin, cleanNew, newName || "Pro Inconnu");
      }
  
      const updateMutation = `
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer { id, email }
            userErrors { field message }
          }
        }
      `;

      const input: any = { id: customerId, email: cleanNew };
      if (newName) {
          const parts = newName.split(" ");
          input.firstName = parts[0];
          input.lastName = parts.slice(1).join(" ") || parts[0];
      }
  
      const res = await admin.graphql(updateMutation, { variables: { input } });
      const json = await res.json() as any;
  
      if (json.data?.customerUpdate?.userErrors?.length > 0) {
          return { success: false, error: json.data.customerUpdate.userErrors[0].message };
      }
  
      return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
}