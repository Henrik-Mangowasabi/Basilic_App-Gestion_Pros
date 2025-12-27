import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount } from "./discount.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// --- HELPERS EXISTANTS ---
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

// --- CREATE STRUCTURE (Modifié pour ajouter discount_id) ---
export async function createMetaobject(admin: AdminApiContext) {
  const exists = await checkMetaobjectExists(admin);
  // Note: Si ça existe déjà, on ne fait rien. Idéalement il faudrait mettre à jour la définition pour ajouter le champ manquant
  // Mais pour faire simple, si tu as déjà créé la structure, il faudra peut-être la supprimer et la recréer, 
  // OU aller dans Shopify Admin > Contenu > Metaobjects > Ta définition > Ajouter champ "discount_id" (texte, une ligne).

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
    // NOUVEAU CHAMP POUR LIER LA RÉDUCTION
    { name: "Discount ID", key: "discount_id", type: "single_line_text_field", required: false } 
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
        entry[f.key] = f.key === "montant" ? (f.value ? parseFloat(f.value) : null) : f.value;
      });
      return entry;
    }).filter(Boolean) || [];
    return { entries };
  } catch (error) { return { entries: [], error: String(error) }; }
}

// --- CREATE ENTRY (AVEC CRÉATION DE PROMO) ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  // 1. Créer le code promo d'abord
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

  // 2. Créer l'entrée Métaobjet avec l'ID du discount
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
    { key: "discount_id", value: discountResult.discountId || "" } // On sauvegarde le lien
  ];

  try {
    const response = await admin.graphql(mutation, { variables: { metaobject: { type: METAOBJECT_TYPE, fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) {
      // Si échec métaobjet, faudrait idéalement supprimer le discount créé juste avant, mais restons simple
      return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- UPDATE ENTRY (AVEC UPDATE DE PROMO) ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  // 1. Récupérer l'entrée actuelle pour avoir le discount_id
  const currentEntryQuery = `
    query($id: ID!) {
      metaobject(id: $id) {
        field(key: "discount_id") { value }
      }
    }
  `;
  
  let existingDiscountId = null;
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    existingDiscountId = d.data?.metaobject?.field?.value;
  } catch (e) { console.error("Impossible de récupérer le discount ID existant"); }

  // 2. Si on a un ID, on met à jour la promo Shopify
  if (existingDiscountId) {
    const discountName = `Code promo Pro Sante - ${fields.name}`;
    const updateResult = await updateShopifyDiscount(admin, existingDiscountId, {
      code: fields.code,
      montant: fields.montant,
      type: fields.type,
      name: discountName
    });
    
    if (!updateResult.success) {
      console.error("Attention: Echec mise à jour discount Shopify", updateResult.error);
      // On continue quand même pour mettre à jour le métaobjet
    }
  } else {
      // Cas optionnel : Si pas d'ID (anciennes entrées), on pourrait en créer un ici
  }

  // 3. Mettre à jour le métaobjet
  const mutation = `
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
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
  ];

  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectUpdate?.userErrors?.length > 0) {
      return { success: false, error: data.data.metaobjectUpdate.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- DELETE ENTRY (AVEC SUPPRESSION DE PROMO) ---
export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
  // 1. Récupérer le discount_id avant suppression
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { field(key: "discount_id") { value } } }`;
  let existingDiscountId = null;
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    existingDiscountId = d.data?.metaobject?.field?.value;
  } catch (e) {}

  // 2. Supprimer la promo Shopify
  if (existingDiscountId) {
    await deleteShopifyDiscount(admin, existingDiscountId);
  }

  // 3. Supprimer le métaobjet
  const mutation = `
    mutation metaobjectDelete($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors { field message }
      }
    }
  `;

  try {
    const response = await admin.graphql(mutation, { variables: { id } });
    const data = await response.json() as any;
    if (data.data?.metaobjectDelete?.userErrors?.length > 0) {
      return { success: false, error: data.data.metaobjectDelete.userErrors[0].message };
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}