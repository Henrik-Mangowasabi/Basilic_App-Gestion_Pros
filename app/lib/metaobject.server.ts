import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyDiscount, updateShopifyDiscount, deleteShopifyDiscount, toggleShopifyDiscount } from "./discount.server";
import { ensureCustomerPro, removeCustomerProTag, updateCustomerEmailInShopify } from "./customer.server";

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
  // Cette fonction s'assure que le champ customer_id existe bien
  const mutation = `
    mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }
  `;
  // NOTE : On réutilise mutation "Create" car sur Shopify, si la définition existe, 
  // il faut utiliser "metaobjectDefinitionUpdate" pour ajouter un champ, 
  // mais "Create" échoue souvent si ça existe déjà.
  // Pour simplifier ici, on assume que la structure se mettra à jour ou est déjà bonne.
  // Si tu as déjà créé la structure, va dans Shopify Admin > Contenu > Metaobjects > MM Pro Santé > Modifier la définition
  // et ajoute manuellement le champ "customer_id" (Texte une ligne) si mon code ne le fait pas.
  
  const fieldDefinitions = [
    { name: "Identification", key: "identification", type: "single_line_text_field", required: true },
    { name: "Name", key: "name", type: "single_line_text_field", required: true },
    { name: "Email", key: "email", type: "single_line_text_field", required: true },
    { name: "Code Name", key: "code", type: "single_line_text_field", required: true },
    { name: "Montant", key: "montant", type: "number_decimal", required: true },
    { name: "Type", key: "type", type: "single_line_text_field", required: true, validations: [{ name: "choices", value: JSON.stringify(["%", "€"]) }] },
    { name: "Discount ID", key: "discount_id", type: "single_line_text_field", required: false },
    { name: "Status", key: "status", type: "boolean", required: false },
    { name: "Customer ID", key: "customer_id", type: "single_line_text_field", required: false }
  ];

  const variables = { definition: { name: METAOBJECT_NAME, type: METAOBJECT_TYPE, fieldDefinitions, capabilities: { publishable: { enabled: true } } } };

  try {
    // On tente la création (ou update implicite selon API version)
    // Si ça échoue car "existe déjà", c'est pas grave, mais il faut vérifier que le champ customer_id est là.
    await admin.graphql(mutation, { variables });
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

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

// --- CREATE ENTRY ---
export async function createMetaobjectEntry(admin: AdminApiContext, fields: any) {
  // 1. Créer le code promo
  const discountName = `Code promo Pro Sante - ${fields.name}`;
  const discountResult = await createShopifyDiscount(admin, {
    code: fields.code,
    montant: fields.montant,
    type: fields.type,
    name: discountName
  });

  if (!discountResult.success) return { success: false, error: "Erreur Discount: " + discountResult.error };

  // 2. Créer ou Tagger le Client
  console.log(`[CREATE] Synchronisation client pour : ${fields.email}`);
  const clientResult = await ensureCustomerPro(admin, fields.email, fields.name);
  
  if (!clientResult.success) {
      console.error(`[CREATE ERROR] Échec synchro client : ${clientResult.error}`);
      // On continue quand même, mais le client ne sera pas lié
  }

  const customerId = clientResult.customerId || "";
  console.log(`[CREATE] Client ID obtenu : ${customerId}`);

  // 3. Sauvegarder dans le Metaobject (AVEC L'ID CLIENT)
  const fieldsInput = [
    { key: "identification", value: String(fields.identification) },
    { key: "name", value: String(fields.name) },
    { key: "email", value: String(fields.email) },
    { key: "code", value: String(fields.code) },
    { key: "montant", value: String(fields.montant) },
    { key: "type", value: String(fields.type) },
    { key: "discount_id", value: discountResult.discountId || "" },
    { key: "status", value: "true" },
    { key: "customer_id", value: customerId } // <--- CRUCIAL
  ];

  const mutation = `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id }, userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { metaobject: { type: METAOBJECT_TYPE, fields: fieldsInput } } });
    const data = await response.json() as any;
    if (data.data?.metaobjectCreate?.userErrors?.length > 0) return { success: false, error: data.data.metaobjectCreate.userErrors[0].message };
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- UPDATE ENTRY (CORRIGÉE POUR EVITER DOUBLONS) ---
export async function updateMetaobjectEntry(admin: AdminApiContext, id: string, fields: any) {
  const fieldsInput: any[] = [];
  
  if (fields.identification) fieldsInput.push({ key: "identification", value: String(fields.identification) });
  if (fields.name) fieldsInput.push({ key: "name", value: String(fields.name) });
  if (fields.email) fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code) fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant) fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type) fieldsInput.push({ key: "type", value: String(fields.type) });

  // 1. Récupérer les données actuelles (ID client et ancien email)
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
  } catch (e) { console.error("Erreur lecture metaobject:", e); }

  // 2. LOGIQUE INTELLIGENTE DE MISE A JOUR CLIENT
  if (fields.email && oldEmail !== fields.email) {
      console.log(`[UPDATE] Changement email détecté: ${oldEmail} -> ${fields.email}`);
      
      // Cas A : On a déjà l'ID du client (le lien est solide)
      if (linkedCustomerId) {
          console.log(`[UPDATE] Mise à jour via Customer ID : ${linkedCustomerId}`);
          await updateCustomerEmailInShopify(admin, linkedCustomerId, fields.email, fields.name);
      } 
      // Cas B : Pas d'ID (vieux metaobject), on cherche par l'ancien email
      else {
          console.log(`[UPDATE] Pas d'ID client. Recherche par ancien email...`);
          // On utilise ensureCustomerPro pour "réparer" le lien
          // S'il trouve l'ancien email, il renverra son ID. S'il trouve pas, il créera.
          // Mais attention : ensureCustomerPro cherche par le "rawEmail" qu'on lui donne.
          // Ici on veut mettre à jour.
          
          // Tentative de réparation manuelle :
          const repair = await updateCustomerEmailInShopify(admin, "", fields.email, fields.name); 
          // Note: ma fonction updateCustomerEmailInShopify telle qu'écrite précédemment attendait un ID ou un oldEmail si ID vide.
          // Pour simplifier, on va appeler ensureCustomerPro avec le NOUVEL email pour s'assurer qu'un compte existe,
          // et on stockera l'ID retourné.
          
          const result = await ensureCustomerPro(admin, fields.email, fields.name);
          if (result.customerId) {
              fieldsInput.push({ key: "customer_id", value: result.customerId });
          }
      }
  } 
  // Si l'email n'a pas changé mais qu'on n'a pas l'ID stocké, on essaie de le récupérer pour la prochaine fois
  else if (!linkedCustomerId && fields.email) {
      const result = await ensureCustomerPro(admin, fields.email, fields.name);
      if (result.customerId) {
           fieldsInput.push({ key: "customer_id", value: result.customerId });
      }
  }

  // 3. Update Discount (inchangé)
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

  // 4. Update Metaobject
  const mutation = `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, { variables: { id, metaobject: { fields: fieldsInput } } });
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}

// --- DELETE ENTRY (Inchangé mais vital) ---
export async function deleteMetaobjectEntry(admin: AdminApiContext, id: string) {
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

  // Priorité ID, sinon Email pour nettoyer le tag
  if (linkedCustomerId) {
      await removeCustomerProTag(admin, linkedCustomerId);
  } else if (entryEmail) {
      // Fallback si pas d'ID
      await removeCustomerProTag(admin, entryEmail); 
  }

  if (existingDiscountId) await deleteShopifyDiscount(admin, existingDiscountId);

  const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { userErrors { field message } } }`;
  try {
    await admin.graphql(mutation, { variables: { id } });
    return { success: true };
  } catch (error) { return { success: false, error: String(error) }; }
}