// FICHIER : app/lib/metaobject.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";
import { ensureCustomerPro, removeCustomerProTag } from "./customer.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// --- HELPERS ---
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

// --- CREATE STRUCTURE ---
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

  const variables = {
    definition: {
      name: METAOBJECT_NAME,
      type: METAOBJECT_TYPE,
      fieldDefinitions,
      capabilities: { publishable: { enabled: true } }
    }
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as any;
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
      return { success: false, error: JSON.stringify(data.data.metaobjectDefinitionCreate.userErrors) };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- GET ENTRIES ---
export async function getMetaobjectEntries(admin: AdminApiContext) {
  const query = `
    query {
      metaobjects(first: 250, type: "${METAOBJECT_TYPE}") {
        edges {
          node {
            id
            fields { key value }
          }
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

// --- CREATE ENTRY (AVEC CLIENT) ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  // 1. Discount
  const discountName = `Code promo Pro Sante - ${fields.name}`;
  const discountResult = await createShopifyDiscount(admin, {
    code: fields.code,
    montant: fields.montant,
    type: fields.type,
    name: discountName
  });

  if (!discountResult.success) {
    return { success: false, error: "Erreur création promo Shopify: " + discountResult.error };
  }

  // 2. Client Sync
  console.log("--- Début synchronisation Client ---");
  const clientResult = await ensureCustomerPro(admin, fields.email, fields.name);
  if (!clientResult.success) {
      console.warn("⚠️ Attention: Erreur lors de la liaison client :", clientResult.error);
  } else {
      console.log("✅ Client synchronisé avec succès :", clientResult.action);
  }

  // 3. Metaobject
  const mutation = `
    mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

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
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) {
      return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- UPDATE ENTRY (CORRIGÉ & RESTAURÉ) ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  // 1. Initialiser le tableau
  const fieldsInput: any[] = [];
  
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });

  // 2. Récupérer l'ID discount existant
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { field(key: "discount_id") { value } } }`;
  let existingDiscountId = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    existingDiscountId = d.data?.metaobject?.field?.value;
  } catch (e) {
    console.error("Erreur récupération discount_id:", e);
  }

  // 3. Logique de mise à jour Shopify (Discount)
  if (existingDiscountId) {
    if (fields.status !== undefined) {
       console.log(`[UPDATE] Toggle status vers : ${fields.status}`);
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
    if (fields.status !== undefined) {
        fieldsInput.push({ key: "status", value: String(fields.status) });
    }
  }

  // 4. Mise à jour du Métaobjet
  const mutation = `
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectUpdate?.userErrors?.length > 0) {
      return { success: false, error: data.data.metaobjectUpdate.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { 
    return { success: false, error: String(error) }; 
  }
}

// --- DELETE ENTRY (AVEC CLIENT) ---
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
  } catch (e) {
    console.error("[DELETE] Erreur récupération données:", e);
  }

  // 2. Suppression Code Promo
  if (existingDiscountId) {
    await deleteShopifyDiscount(admin, existingDiscountId);
  }

  // 3. Retirer le tag client
  if (entryEmail) {
      console.log(`[DELETE] Retrait du tag pour l'email : ${entryEmail}`);
      await removeCustomerProTag(admin, entryEmail);
  }

  // 4. Suppression Métaobjet
  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { deletedId, userErrors { field message } } }`;
  try {
    await admin.graphql(mutation, { variables: { id } });
    console.log(`[DELETE] Entrée métaobjet supprimée.`);
    return { success: true };
  } catch (error) { 
    return { success: false, error: String(error) }; 
  }
}