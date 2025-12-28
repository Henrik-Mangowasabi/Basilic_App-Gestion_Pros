// FICHIER : app/lib/metaobject.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";
// On importe la nouvelle fonction updateCustomerEmailInShopify
import { ensureCustomerPro, removeCustomerProTag, updateCustomerEmailInShopify } from "./customer.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// --- HELPERS & STRUCTURE (Inchangé) ---
export async function checkMetaobjectExists(admin: AdminApiContext): Promise<boolean> {
  const query = `query { metaobjectDefinitions(first: 250) { edges { node { type } } } }`;
  try {
    const response = await admin.graphql(query);
    const data = await response.json() as any;
    return data.data?.metaobjectDefinitions?.edges?.some((e: any) => e.node?.type === METAOBJECT_TYPE);
  } catch (error) { return false; }
}

export async function checkMetaobjectStatus(admin: AdminApiContext) {
  const exists = await checkMetaobjectExists(admin);
  return { exists };
}

export async function createMetaobject(admin: AdminApiContext) {
  const exists = await checkMetaobjectExists(admin);
  const mutation = `
    mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }
  `;
  const fieldDefinitions = [
    { name: "Identification", key: "identification", type: "single_line_text_field", required: true },
    { name: "Name", key: "name", type: "single_line_text_field", required: true },
    { name: "Email", key: "email", type: "single_line_text_field", required: true },
    { name: "Code Name", key: "code", type: "single_line_text_field", required: true },
    { name: "Montant", key: "montant", type: "number_decimal", required: true },
    { name: "Type", key: "type", type: "single_line_text_field", required: true, validations: [{ name: "choices", value: JSON.stringify(["%", "€"]) }] },
    { name: "Discount ID", key: "discount_id", type: "single_line_text_field", required: false },
    { name: "Status", key: "status", type: "boolean", required: false }
  ];
  const variables = { definition: { name: METAOBJECT_NAME, type: METAOBJECT_TYPE, fieldDefinitions, capabilities: { publishable: { enabled: true } } } };
  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as any;
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) return { success: false, error: JSON.stringify(data.data.metaobjectDefinitionCreate.userErrors) };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

export async function getMetaobjectEntries(admin: AdminApiContext) {
  const query = `
    query {
      metaobjects(first: 250, type: "${METAOBJECT_TYPE}") {
        edges {
          node { id, fields { key value } }
        }
      }
    }
  `;
  try {
    const response = await admin.graphql(query);
    const data = await response.json() as any;
    const entries = data.data?.metaobjects?.edges?.map((edge: any) => {
      const node = edge.node;
      const entry: any = { id: node.id };
      node.fields.forEach((f: any) => {
        if (f.key === "montant") entry[f.key] = f.value ? parseFloat(f.value) : null;
        else if (f.key === "status") entry[f.key] = f.value === "true"; 
        else entry[f.key] = f.value;
      });
      if (entry.status === undefined) entry.status = true; 
      return entry;
    }).filter(Boolean) || [];
    return { entries };
  } catch (error) { return { entries: [], error: String(error) }; }
}

// --- CREATE ENTRY (Inchangé) ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  const discountName = `Code promo Pro Sante - ${fields.name}`;
  const discountResult = await createShopifyDiscount(admin, {
    code: fields.code,
    montant: fields.montant,
    type: fields.type,
    name: discountName
  });
  if (!discountResult.success) return { success: false, error: "Erreur création promo Shopify: " + discountResult.error };

  const clientResult = await ensureCustomerPro(admin, fields.email, fields.name);
  
  const mutation = `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id }, userErrors { field message } } }`;
  const fieldsInput = [
    { key: "identification", value: String(fields.identification) },
    { key: "name", value: String(fields.name) },
    { key: "email", value: String(fields.email) },
    { key: "code", value: String(fields.code) },
    { key: "montant", value: String(fields.montant) },
    { key: "type", value: String(fields.type) },
    { key: "discount_id", value: discountResult.discountId || "" },
    { key: "status", value: "true" }
  ];
  try {
    const response = await admin.graphql(mutation, { variables: { metaobject: { type: METAOBJECT_TYPE, fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- UPDATE ENTRY (VERSION AVANCÉE - SYNC CLIENT) ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  const fieldsInput: any[] = [];
  
  // Construction dynamique des champs
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });

  // 1. Récupérer les données ACTUELLES avant modification (pour comparer)
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let existingDiscountId = null;
  let oldEmail = null;
  let oldName = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    const currentFields = d.data?.metaobject?.fields || [];
    
    existingDiscountId = currentFields.find((f:any) => f.key === "discount_id")?.value;
    oldEmail = currentFields.find((f:any) => f.key === "email")?.value;
    oldName = currentFields.find((f:any) => f.key === "name")?.value;
    
  } catch (e) { console.error("Erreur lecture metaobject:", e); }

  // --- LOGIQUE SYNC CLIENT (NOUVEAU) ---
  // Si on a un ancien email et que le nouveau est différent, on met à jour Shopify
  if (oldEmail && fields.email && oldEmail !== fields.email) {
      console.log(`[UPDATE] Changement d'email détecté : ${oldEmail} -> ${fields.email}`);
      await updateCustomerEmailInShopify(admin, oldEmail, fields.email, fields.name || oldName);
  } else if (oldEmail && fields.name && fields.name !== oldName) {
      // Si seul le nom change, on peut aussi le mettre à jour (optionnel, mais propre)
      await updateCustomerEmailInShopify(admin, oldEmail, oldEmail, fields.name);
  }

  // --- LOGIQUE SYNC DISCOUNT ---
  if (existingDiscountId) {
    if (fields.status !== undefined) {
       fieldsInput.push({ key: "status", value: String(fields.status) });
       await toggleShopifyDiscount(admin, existingDiscountId, fields.status);
    } 
    else {
       const discountName = `Code promo Pro Sante - ${fields.name || "Updated"}`;
       if (fields.code && fields.montant) {
           await updateShopifyDiscount(admin, existingDiscountId, {
             code: fields.code,
             montant: fields.montant,
             type: fields.type,
             name: discountName
           });
       }
    }
  } else {
    if (fields.status !== undefined) fieldsInput.push({ key: "status", value: String(fields.status) });
  }

  // --- UPDATE METAOBJECT ---
  const mutation = `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id }, userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectUpdate?.userErrors?.length > 0) return { success: false, error: data.data.metaobjectUpdate.userErrors[0].message };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
  console.log(`[DELETE] Tentative de suppression pour l'entrée : ${id}`);

  // 1. Récupérer les infos (Discount ID ET Email) AVANT suppression
  const currentEntryQuery = `
    query($id: ID!) { 
      metaobject(id: $id) { 
        fields { key, value }
      } 
    }
  `;
  
  let existingDiscountId = null;
  let entryEmail = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    
    const fields = d.data?.metaobject?.fields || [];
    existingDiscountId = fields.find((f:any) => f.key === "discount_id")?.value;
    entryEmail = fields.find((f:any) => f.key === "email")?.value;
    
    console.log(`[DELETE] Données récupérées -> Email: "${entryEmail}", DiscountID: "${existingDiscountId}"`);
  } catch (e) {
    console.error("[DELETE] Erreur critique récupération données:", e);
  }

  // 2. Retirer le tag client (PRIORITÉ : On le fait avant de tout casser)
  if (entryEmail) {
      console.log(`[DELETE] Appel suppression tag pour : ${entryEmail}`);
      // On attend bien la fin de l'opération
      await removeCustomerProTag(admin, entryEmail);
  } else {
      console.warn(`[DELETE] Attention : Pas d'email trouvé dans l'entrée. Impossible de retirer le tag.`);
  }

  // 3. Suppression Code Promo
  if (existingDiscountId) {
    await deleteShopifyDiscount(admin, existingDiscountId);
  }

  // 4. Suppression Métaobjet (L'entrée elle-même)
  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { deletedId, userErrors { field message } } }`;
  try {
    await admin.graphql(mutation, { variables: { id } });
    console.log(`[DELETE] Entrée supprimée avec succès.`);
    return { success: true };
  } catch (error) { 
    return { success: false, error: String(error) }; 
  }
}