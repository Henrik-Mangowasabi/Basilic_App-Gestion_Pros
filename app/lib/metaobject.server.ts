import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";

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
    // NOUVEAU CHAMP STATUS (true = actif, false = inactif)
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
        else if (f.key === "status") entry[f.key] = f.value === "true"; // Conversion string -> boolean
        else entry[f.key] = f.value;
      });
      // Valeur par défaut si status n'existe pas encore
      if (entry.status === undefined) entry.status = true; 
      return entry;
    }).filter(Boolean) || [];
    return { entries };
  } catch (error) { return { entries: [], error: String(error) }; }
}

// --- CREATE ENTRY ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
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
    { key: "status", value: "true" } // Actif par défaut à la création
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

// --- UPDATE ENTRY ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  // Récupérer l'ID discount existant
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { field(key: "discount_id") { value } } }`;
  let existingDiscountId = null;
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    existingDiscountId = d.data?.metaobject?.field?.value;
  } catch (e) {}

  if (existingDiscountId) {
    // Si c'est juste un toggle de status
    if (fields.status !== undefined) fieldsInput.push({ key: "status", value: String(fields.status) })
       await toggleShopifyDiscount(admin, existingDiscountId, fields.status);
    } else {
       // Sinon mise à jour complète
       const discountName = `Code promo Pro Sante - ${fields.name}`;
       await updateShopifyDiscount(admin, existingDiscountId, {
         code: fields.code,
         montant: fields.montant,
         type: fields.type,
         name: discountName
       });
    }
  }

  const mutation = `
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  // Construction dynamique des champs à mettre à jour
  const fieldsInput = [];
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });
  if (fields.status !== undefined) fieldsInput.push({ key: "status", value: String(fields.status) });

  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectUpdate?.userErrors?.length > 0) {
      return { success: false, error: data.data.metaobjectUpdate.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- DELETE ENTRY (Optimisé avec Logs) ---
export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
  console.log(`[DELETE] Tentative de suppression pour l'entrée : ${id}`);

  // 1. Récupérer le discount_id avant suppression
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { field(key: "discount_id") { value } } }`;
  let existingDiscountId = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    existingDiscountId = d.data?.metaobject?.field?.value;
    console.log(`[DELETE] ID Discount trouvé : ${existingDiscountId}`);
  } catch (e) {
    console.error("[DELETE] Erreur lors de la récupération du discount_id:", e);
  }

  // 2. Supprimer la promo Shopify SI un ID existe
  if (existingDiscountId) {
    console.log(`[DELETE] Suppression du code promo Shopify ID: ${existingDiscountId}...`);
    const deleteResult = await deleteShopifyDiscount(admin, existingDiscountId);
    if (deleteResult.success) {
      console.log("[DELETE] Code promo supprimé avec succès.");
    } else {
      console.error("[DELETE] Échec suppression code promo:", deleteResult.error);
    }
  } else {
    console.log("[DELETE] Aucun code promo lié à supprimer (ou ID manquant).");
  }

  // 3. Supprimer le métaobjet
  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { deletedId, userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { id } });
    console.log(`[DELETE] Entrée métaobjet supprimée.`);
    return { success: true };
  } catch (error) { 
    console.error("[DELETE] Erreur fatale:", error);
    return { success: false, error: String(error) }; 
  }
}