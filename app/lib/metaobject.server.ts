// FICHIER : app/lib/metaobject.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";
import { ensureCustomerPro, removeCustomerProTag, updateCustomerEmailInShopify } from "./customer.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// ... (Helpers inchangés : checkMetaobjectExists, checkMetaobjectStatus) ...
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
  const mutation = `mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $definition) { userErrors { field message } } }`;

  const fieldDefinitions = [
    { name: "Identification", key: "identification", type: "single_line_text_field", required: true },
    { name: "Name", key: "name", type: "single_line_text_field", required: true },
    { name: "Email", key: "email", type: "single_line_text_field", required: true },
    { name: "Code Name", key: "code", type: "single_line_text_field", required: true },
    { name: "Montant", key: "montant", type: "number_decimal", required: true },
    { name: "Type", key: "type", type: "single_line_text_field", required: true, validations: [{ name: "choices", value: JSON.stringify(["%", "€"]) }] },
    { name: "Discount ID", key: "discount_id", type: "single_line_text_field", required: false },
    { name: "Status", key: "status", type: "boolean", required: false },
    // NOUVEAU CHAMP : Pour stocker l'ID du client Shopify
    { name: "Customer ID", key: "customer_id", type: "single_line_text_field", required: false }
  ];

  const variables = { definition: { name: METAOBJECT_NAME, type: METAOBJECT_TYPE, fieldDefinitions, capabilities: { publishable: { enabled: true } } } };
  // ... (Reste de la fonction createMetaobject identique, juste envoyer la mutation)
  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as any;
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) return { success: false, error: JSON.stringify(data.data.metaobjectDefinitionCreate.userErrors) };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// GET ENTRIES (Inchangé)
export async function getMetaobjectEntries(admin: AdminApiContext) {
    const query = `query { metaobjects(first: 250, type: "${METAOBJECT_TYPE}") { edges { node { id, fields { key value } } } } }`;
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

// --- CREATE ENTRY (Sauvegarde le Customer ID) ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  // 1. Discount
  const discountName = `Code promo Pro Sante - ${fields.name}`;
  const discountResult = await createShopifyDiscount(admin, { code: fields.code, montant: fields.montant, type: fields.type, name: discountName });
  if (!discountResult.success) return { success: false, error: "Erreur promo: " + discountResult.error };

  // 2. Client (On récupère l'ID !)
  const clientResult = await ensureCustomerPro(admin, fields.email, fields.name);
  const customerId = clientResult.customerId || ""; // <--- On capture l'ID

  // 3. Métaobjet
  const fieldsInput = [
    { key: "identification", value: String(fields.identification) },
    { key: "name", value: String(fields.name) },
    { key: "email", value: String(fields.email) },
    { key: "code", value: String(fields.code) },
    { key: "montant", value: String(fields.montant) },
    { key: "type", value: String(fields.type) },
    { key: "discount_id", value: discountResult.discountId || "" },
    { key: "status", value: "true" },
    { key: "customer_id", value: customerId } // <--- On sauvegarde l'ID
  ];

  const mutation = `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { metaobject: { type: METAOBJECT_TYPE, fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- UPDATE ENTRY (Utilise Customer ID) ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  const fieldsInput: any[] = [];
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });

  // Récupérer les infos actuelles (dont Customer ID)
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let existingDiscountId = null;
  let linkedCustomerId = null;
  let oldEmail = null;

  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    const currentFields = d.data?.metaobject?.fields || [];
    existingDiscountId = currentFields.find((f:any) => f.key === "discount_id")?.value;
    linkedCustomerId = currentFields.find((f:any) => f.key === "customer_id")?.value; // On cherche l'ID
    oldEmail = currentFields.find((f:any) => f.key === "email")?.value;
  } catch (e) { console.error("Erreur lecture metaobject:", e); }

  // LOGIQUE CLIENT UPDATE
  // Si on a un ID client et que l'email a changé, on met à jour via l'ID (plus fiable)
  if (linkedCustomerId && fields.email && oldEmail !== fields.email) {
      await updateCustomerEmailInShopify(admin, linkedCustomerId, fields.email, fields.name);
  }
  // Fallback : Si on n'avait pas encore d'ID (anciennes entrées), on essaie de réparer
  else if (!linkedCustomerId && fields.email) {
      const repair = await ensureCustomerPro(admin, fields.email, fields.name || "Pro");
      if (repair.customerId) {
          fieldsInput.push({ key: "customer_id", value: repair.customerId }); // On sauve l'ID pour la prochaine fois
      }
  }

  // LOGIQUE DISCOUNT (Inchangée)
  if (existingDiscountId) {
    if (fields.status !== undefined) {
       fieldsInput.push({ key: "status", value: String(fields.status) });
       await toggleShopifyDiscount(admin, existingDiscountId, fields.status);
    } 
    else if (fields.code && fields.montant) {
       await updateShopifyDiscount(admin, existingDiscountId, { code: fields.code, montant: fields.montant, type: fields.type, name: `Code promo Pro Sante - ${fields.name}` });
    }
  } else {
     if (fields.status !== undefined) fieldsInput.push({ key: "status", value: String(fields.status) });
  }

  // UPDATE
  const mutation = `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectUpdate?.userErrors?.length > 0) return { success: false, error: data.data.metaobjectUpdate.userErrors[0].message };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- DELETE ENTRY (Fiable avec Customer ID) ---
export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let existingDiscountId = null;
  let linkedCustomerId = null;

  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    const fields = d.data?.metaobject?.fields || [];
    existingDiscountId = fields.find((f:any) => f.key === "discount_id")?.value;
    linkedCustomerId = fields.find((f:any) => f.key === "customer_id")?.value; // On cherche l'ID
  } catch (e) { console.error("[DELETE] Erreur lecture:", e); }

  // 1. Retirer Tag (Via ID direct, infaillible)
  if (linkedCustomerId) {
      await removeCustomerProTag(admin, linkedCustomerId);
  }

  // 2. Supprimer Discount
  if (existingDiscountId) await deleteShopifyDiscount(admin, existingDiscountId);

  // 3. Supprimer Entrée
  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { userErrors { field message } } }`;
  try {
    await admin.graphql(mutation, { variables: { id } });
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}