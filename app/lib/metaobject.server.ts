// FICHIER : app/lib/metaobject.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";
import { ensureCustomerPro, removeCustomerProTag, updateCustomerEmailInShopify } from "./customer.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// --- 1. VÉRIFICATION ET STRUCTURE ---

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
  // Cette mutation sert à créer ou mettre à jour la définition si elle n'est pas "verrouillée" par Shopify
  // Assure-toi que le champ customer_id est bien présent dans ton admin Shopify si cette fonction ne suffit pas.
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
    { name: "Status", key: "status", type: "boolean", required: false },
    // LE CHAMP CRITIQUE POUR LA SYNCHRO :
    { name: "Customer ID", key: "customer_id", type: "single_line_text_field", required: false }
  ];

  const variables = { definition: { name: METAOBJECT_NAME, type: METAOBJECT_TYPE, fieldDefinitions, capabilities: { publishable: { enabled: true } } } };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as any;
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
        // On log l'erreur mais on ne bloque pas si c'est juste "existe déjà"
        console.warn("Info Structure:", JSON.stringify(data.data.metaobjectDefinitionCreate.userErrors));
    }
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- 2. LECTURE DES ENTRÉES ---

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

// --- 3. CRÉATION D'UNE ENTRÉE (ET SYNCHRO CLIENT) ---

export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  console.log(`[CREATE] Démarrage création pour : ${fields.email}`);

  // A. Création du Code Promo
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

  // B. Création / Liaison du Client
  // On appelle la fonction qui crée ou tague le client, et surtout QUI RETOURNE SON ID
  const clientResult = await ensureCustomerPro(admin, fields.email, fields.name);
  
  if (!clientResult.success) {
      console.warn("⚠️ Erreur liaison client :", clientResult.error);
  }

  // C. Récupération de l'ID Client pour sauvegarde
  const customerIdToSave = clientResult.customerId ? String(clientResult.customerId) : "";
  console.log(`[CREATE] ID Client à sauvegarder : "${customerIdToSave}"`);

  // D. Préparation des champs Métaobjet
  const fieldsInput = [
    { key: "identification", value: String(fields.identification) },
    { key: "name", value: String(fields.name) },
    { key: "email", value: String(fields.email) },
    { key: "code", value: String(fields.code) },
    { key: "montant", value: String(fields.montant) },
    { key: "type", value: String(fields.type) },
    { key: "discount_id", value: discountResult.discountId || "" },
    { key: "status", value: "true" },
    // ICI ON SAUVEGARDE L'ID CLIENT :
    { key: "customer_id", value: customerIdToSave } 
  ];

  const mutation = `
    mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  try {
    const response = await admin.graphql(mutation, { variables: { metaobject: { type: METAOBJECT_TYPE, fields: fieldsInput } } });
    const data = await response.json() as any;
    
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) {
      console.error("[CREATE ERROR]", data.data.metaobjectCreate.userErrors);
      return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    }
    
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- 4. MISE À JOUR (UPDATE) ---

export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  const fieldsInput: any[] = [];
  
  // Construction dynamique des champs à update
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });

  // A. Récupérer les données actuelles (ID client et ancien email)
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let existingDiscountId = null;
  let linkedCustomerId = null;
  let oldEmail = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    const currentFields = d.data?.metaobject?.fields || [];
    
    existingDiscountId = currentFields.find((f:any) => f.key === "discount_id")?.value;
    linkedCustomerId = currentFields.find((f:any) => f.key === "customer_id")?.value;
    oldEmail = currentFields.find((f:any) => f.key === "email")?.value;
    
    console.log(`[UPDATE] Données actuelles -> ID Client: ${linkedCustomerId}, Email: ${oldEmail}`);
  } catch (e) { console.error("Erreur lecture metaobject:", e); }

  // B. LOGIQUE INTELLIGENTE CLIENT (Anti-Doublon)
  if (fields.email && oldEmail !== fields.email) {
      console.log(`[UPDATE] Changement email: ${oldEmail} -> ${fields.email}`);
      
      if (linkedCustomerId) {
          // CAS 1 : On a l'ID, on met à jour le client existant
          console.log(`[UPDATE] Via ID Client : ${linkedCustomerId}`);
          await updateCustomerEmailInShopify(admin, linkedCustomerId, fields.email, fields.name);
      } else {
          // CAS 2 : Pas d'ID (vieux metaobject), on tente de réparer
          console.log(`[UPDATE] Pas d'ID. Tentative de réparation/création...`);
          // On appelle ensureCustomerPro avec le NOUVEL email pour s'assurer qu'un compte existe
          const repair = await ensureCustomerPro(admin, fields.email, fields.name || "Pro Updated");
          
          if (repair.customerId) {
              // On sauvegarde l'ID pour la prochaine fois !
              fieldsInput.push({ key: "customer_id", value: String(repair.customerId) });
          }
      }
  } 
  // Si l'email n'a pas changé mais qu'on n'a pas l'ID, on essaie de l'ajouter silencieusement
  else if (!linkedCustomerId && fields.email) {
       const repair = await ensureCustomerPro(admin, fields.email, fields.name || "Pro");
       if (repair.customerId) {
           fieldsInput.push({ key: "customer_id", value: String(repair.customerId) });
       }
  }

  // C. Update Discount
  if (existingDiscountId) {
    if (fields.status !== undefined) {
       fieldsInput.push({ key: "status", value: String(fields.status) });
       await toggleShopifyDiscount(admin, existingDiscountId, fields.status);
    } 
    else if (fields.code && fields.montant) {
       await updateShopifyDiscount(admin, existingDiscountId, {
         code: fields.code,
         montant: fields.montant,
         type: fields.type,
         name: `Code promo Pro Sante - ${fields.name}`
       });
    }
  } else {
     if (fields.status !== undefined) fieldsInput.push({ key: "status", value: String(fields.status) });
  }

  // D. Update Metaobject
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
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- 5. SUPPRESSION (DELETE) ---

export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
  console.log(`[DELETE] Suppression entrée : ${id}`);

  // A. Récupération des infos avant suppression
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let existingDiscountId = null;
  let linkedCustomerId = null;
  let entryEmail = null;
  
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = await r.json() as any;
    const fields = d.data?.metaobject?.fields || [];
    existingDiscountId = fields.find((f:any) => f.key === "discount_id")?.value;
    linkedCustomerId = fields.find((f:any) => f.key === "customer_id")?.value;
    entryEmail = fields.find((f:any) => f.key === "email")?.value;
  } catch (e) { console.error("[DELETE] Erreur lecture:", e); }

  // B. Retrait du Tag Client
  // On priorise l'ID car c'est infaillible. Sinon on tente l'email.
  if (linkedCustomerId) {
      console.log(`[DELETE] Retrait tag via ID: ${linkedCustomerId}`);
      await removeCustomerProTag(admin, linkedCustomerId);
  } else if (entryEmail) {
      console.log(`[DELETE] Retrait tag via Email (fallback): ${entryEmail}`);
      await removeCustomerProTag(admin, entryEmail);
  }

  // C. Suppression Discount
  if (existingDiscountId) {
      await deleteShopifyDiscount(admin, existingDiscountId);
  }

  // D. Suppression Métaobjet
  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { userErrors { field message } } }`;
  try {
    await admin.graphql(mutation, { variables: { id } });
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

/**
 * FONCTION "NUCLÉAIRE" : Nettoie tout et supprime la structure
 */
export async function destroyMetaobjectStructure(admin: AdminApiContext) {
  console.log("☢️ DÉMARRAGE SUPPRESSION TOTALE...");

  // 1. On récupère toutes les entrées existantes pour nettoyer les side-effects
  const { entries } = await getMetaobjectEntries(admin);

  console.log(`🧹 Nettoyage de ${entries.length} entrées (Tags & Codes Promo)...`);

  // On utilise ta fonction existante deleteMetaobjectEntry pour faire le nettoyage propre (tag + promo)
  // On le fait en série pour ne pas surcharger l'API
  for (const entry of entries) {
    await deleteMetaobjectEntry(admin, entry.id);
  }

  // 2. Maintenant que c'est vide, on supprime la Définition du Métaobjet
  const queryDefinition = `query { metaobjectDefinitions(first: 10, query:"type:${METAOBJECT_TYPE}") { edges { node { id } } } }`;
  
  try {
    const r = await admin.graphql(queryDefinition);
    const d = await r.json() as any;
    const definitionId = d.data?.metaobjectDefinitions?.edges?.[0]?.node?.id;

    if (definitionId) {
      console.log(`🗑 Suppression de la définition : ${definitionId}`);
      const mutation = `mutation metaobjectDefinitionDelete($id: ID!) { metaobjectDefinitionDelete(id: $id) { userErrors { field message } } }`;
      await admin.graphql(mutation, { variables: { id: definitionId } });
      return { success: true, message: "Structure et données entièrement supprimées." };
    } else {
      return { success: true, message: "Données supprimées, mais structure introuvable (déjà supprimée ?)." };
    }

  } catch (error) {
    return { success: false, error: String(error) };
  }
}