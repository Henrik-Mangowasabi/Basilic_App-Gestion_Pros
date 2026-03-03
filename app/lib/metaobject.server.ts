// FICHIER : app/lib/metaobject.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  createShopifyDiscount,
  updateShopifyDiscount,
  deleteShopifyDiscount,
  toggleShopifyDiscount,
} from "./discount.server";
import {
  ensureCustomerPro,
  removeCustomerProTag,
  updateCustomerInShopify,
  updateCustomerProMetafields,
  deleteCustomerCodePromo,
} from "./customer.server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

// --- VÉRIFICATIONS ---
export async function checkMetaobjectExists(
  admin: AdminApiContext,
): Promise<boolean> {
  const query = `query { metaobjectDefinitions(first: 250) { edges { node { type } } } }`;
  try {
    const response = await admin.graphql(query);
    const data = (await response.json()) as any;
    return data.data?.metaobjectDefinitions?.edges?.some(
      (e: any) => e.node?.type === METAOBJECT_TYPE,
    );
  } catch (error) {
    return false;
  }
}

export async function checkMetaobjectStatus(admin: AdminApiContext) {
  const exists = await checkMetaobjectExists(admin);
  return { exists };
}

// --- MIGRATION : Ajoute first_name/last_name si manquants dans la définition ---
export async function migrateMetaobjectDefinition(admin: AdminApiContext) {
  try {
    // 1. Récupérer la définition et ses champs
    const query = `query {
      metaobjectDefinitions(first: 250) {
        edges { node { id type displayNameKey fieldDefinitions { key } } }
      }
    }`;
    const r = await admin.graphql(query);
    const d = (await r.json()) as any;
    const defNode = d.data?.metaobjectDefinitions?.edges?.find(
      (e: any) => e.node?.type === METAOBJECT_TYPE,
    )?.node;
    if (!defNode) return;

    console.log(`[MIGRATE] displayNameKey actuel: "${defNode.displayNameKey}"`);

    // 2. Vérifier s'il y a des entrées existantes
    const entriesQuery = `query { metaobjects(first: 1, type: "${METAOBJECT_TYPE}") { edges { node { id } } } }`;
    const er = await admin.graphql(entriesQuery);
    const ed = (await er.json()) as any;
    const hasEntries = (ed.data?.metaobjects?.edges?.length ?? 0) > 0;

    if (!hasEntries) {
      // Aucune entrée → détruire et recréer avec displayNameKey dans le CREATE
      console.log("[MIGRATE] Aucune entrée — suppression et recréation de la définition avec displayNameKey...");
      const deleteMutation = `mutation metaobjectDefinitionDelete($id: ID!) {
        metaobjectDefinitionDelete(id: $id) { userErrors { field message } }
      }`;
      const dr = await admin.graphql(deleteMutation, { variables: { id: defNode.id } });
      const dd = (await dr.json()) as any;
      if (dd.data?.metaobjectDefinitionDelete?.userErrors?.length > 0) {
        console.warn("[MIGRATE] Erreur suppression définition:", JSON.stringify(dd.data.metaobjectDefinitionDelete.userErrors));
        return;
      }
      const result = await createMetaobject(admin);
      console.log("[MIGRATE] Définition recréée avec displayNameKey:", result.success ? "OK" : result.error);
      return;
    }

    // 3. Des entrées existent — ajouter les champs manquants + tenter de mettre à jour displayNameKey
    const existingKeys: string[] = defNode.fieldDefinitions.map((f: any) => f.key);
    const toAdd: any[] = [];

    if (!existingKeys.includes("first_name")) {
      toAdd.push({ name: "Prénom", key: "first_name", type: "single_line_text_field", required: false });
    }
    if (!existingKeys.includes("last_name")) {
      toAdd.push({ name: "Nom", key: "last_name", type: "single_line_text_field", required: false });
    }
    if (!existingKeys.includes("cache_revenue")) {
      toAdd.push({ name: "Cache Revenue", key: "cache_revenue", type: "number_decimal", required: false });
    }
    if (!existingKeys.includes("cache_orders_count")) {
      toAdd.push({ name: "Cache Orders Count", key: "cache_orders_count", type: "number_integer", required: false });
    }
    if (!existingKeys.includes("cache_credit_earned")) {
      toAdd.push({ name: "Cache Credit Earned", key: "cache_credit_earned", type: "number_decimal", required: false });
    }
    if (!existingKeys.includes("cache_ca_remainder")) {
      toAdd.push({ name: "Cache CA Remainder", key: "cache_ca_remainder", type: "number_decimal", required: false });
    }

    const fieldDefinitionsOps = toAdd.map(f => ({
      create: { name: f.name, key: f.key, type: f.type },
    }));

    const definitionUpdate: Record<string, unknown> = { displayNameKey: "identification" };
    if (fieldDefinitionsOps.length > 0) {
      definitionUpdate.fieldDefinitions = fieldDefinitionsOps;
      console.log(`[MIGRATE] Ajout de ${toAdd.length} champ(s):`, toAdd.map(f => f.key));
    }

    const mutation = `mutation metaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
      metaobjectDefinitionUpdate(id: $id, definition: $definition) {
        metaobjectDefinition { id displayNameKey }
        userErrors { field message }
      }
    }`;
    const mr = await admin.graphql(mutation, {
      variables: { id: defNode.id, definition: definitionUpdate },
    });
    const md = (await mr.json()) as any;
    if (md.data?.metaobjectDefinitionUpdate?.userErrors?.length > 0) {
      console.warn("[MIGRATE] Erreurs:", JSON.stringify(md.data.metaobjectDefinitionUpdate.userErrors));
    } else {
      const updatedKey = md.data?.metaobjectDefinitionUpdate?.metaobjectDefinition?.displayNameKey;
      console.log(`[MIGRATE] Mise à jour réussie. displayNameKey après update: "${updatedKey}"`);
    }
  } catch (e) {
    console.warn("[MIGRATE] Exception (non-bloquant):", e);
  }
}

// --- CRÉATION STRUCTURE ---
export async function createMetaobject(admin: AdminApiContext) {
  const mutation = `
    mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }
  `;

  const fieldDefinitions = [
    {
      name: "Identification",
      key: "identification",
      type: "single_line_text_field",
      required: true,
    },
    {
      name: "Prénom",
      key: "first_name",
      type: "single_line_text_field",
      required: true,
    },
    {
      name: "Nom",
      key: "last_name",
      type: "single_line_text_field",
      required: true,
    },
    {
      name: "Email",
      key: "email",
      type: "single_line_text_field",
      required: true,
    },
    {
      name: "Code Name",
      key: "code",
      type: "single_line_text_field",
      required: true,
    },
    {
      name: "Montant",
      key: "montant",
      type: "number_decimal",
      required: true,
    },
    {
      name: "Type",
      key: "type",
      type: "single_line_text_field",
      required: true,
      validations: [{ name: "choices", value: JSON.stringify(["%", "€"]) }],
    },
    {
      name: "Discount ID",
      key: "discount_id",
      type: "single_line_text_field",
      required: false,
    },
    { name: "Status", key: "status", type: "boolean", required: false },
    {
      name: "Customer ID",
      key: "customer_id",
      type: "single_line_text_field",
      required: false,
    },
    {
      name: "Profession",
      key: "profession",
      type: "single_line_text_field",
      required: false,
    },
    {
      name: "Adresse",
      key: "adresse",
      type: "single_line_text_field",
      required: false,
    },
    // --- AJOUTS POUR PERFORMANCE ---
    {
      name: "Cache Revenue",
      key: "cache_revenue",
      type: "number_decimal",
      required: false,
    },
    {
      name: "Cache Orders Count",
      key: "cache_orders_count",
      type: "number_integer",
      required: false,
    },
    {
      name: "Cache Credit Earned",
      key: "cache_credit_earned",
      type: "number_decimal",
      required: false,
    },
    {
      name: "Cache CA Remainder",
      key: "cache_ca_remainder",
      type: "number_decimal",
      required: false,
    },
  ];

  const variables = {
    definition: {
      name: METAOBJECT_NAME,
      type: METAOBJECT_TYPE,
      displayNameKey: "identification",
      fieldDefinitions,
      capabilities: { publishable: { enabled: true } },
    },
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = (await response.json()) as any;
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
      const errors = data.data.metaobjectDefinitionCreate.userErrors;
      if (errors[0].message.includes("taken")) return { success: true };
      return { success: false, error: errors[0].message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// --- LECTURE ---
export async function getMetaobjectEntries(admin: AdminApiContext) {
  const query = `
    query GetMetaobjects($cursor: String) {
      metaobjects(first: 250, type: "${METAOBJECT_TYPE}", after: $cursor) {
        edges {
          node {
            id
            fields { key value }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const allEntries: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  try {
    while (hasNextPage) {
      const response = await admin.graphql(query, { variables: { cursor } });
      const data = (await response.json()) as any;
      const edges = data.data?.metaobjects?.edges || [];

      for (const edge of edges) {
        const node = edge.node;
        const entry: any = { id: node.id };
        node.fields.forEach((f: any) => {
          if (f.key === "montant")
            entry[f.key] = f.value ? parseFloat(f.value) : null;
          else if (f.key === "status") entry[f.key] = f.value === "true";
          else entry[f.key] = f.value;
        });
        if (entry.status === undefined) entry.status = true;
        // Rétrocompatibilité : si l'ancienne structure a "name" mais pas first_name/last_name
        if (!entry.first_name && !entry.last_name && entry.name) {
          const parts = (entry.name as string).trim().split(" ");
          entry.first_name = parts[0] || "";
          entry.last_name = parts.slice(1).join(" ") || "";
        }
        // Nom complet calculé pour les pages secondaires
        entry.name = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.name || "";
        allEntries.push(entry);
      }

      hasNextPage = !!data.data?.metaobjects?.pageInfo?.hasNextPage;
      cursor = data.data?.metaobjects?.pageInfo?.endCursor ?? null;
    }
    return { entries: allEntries };
  } catch (error) {
    return { entries: [], error: String(error) };
  }
}

// --- CRÉATION ENTRÉE (Avec Rollback & Cache) ---
export async function createMetaobjectEntry(
  admin: AdminApiContext,
  fields: any,
) {
  const fullName = `${fields.first_name || ""} ${fields.last_name || ""}`.trim();
  const discountName = `Code promo Pro Sante - ${fullName}`;
  let discountIdCreated: string | null = null;
  let customerIdToSave: string = "";

  console.log("🚀 Début transaction création...");

  // 1. CRÉATION CODE PROMO
  const discountResult = await createShopifyDiscount(admin, {
    code: fields.code,
    montant: fields.montant,
    type: fields.type,
    name: discountName,
  });

  if (!discountResult.success) {
    return {
      success: false,
      error: "Erreur Création Promo: " + discountResult.error,
    };
  }
  discountIdCreated = discountResult.discountId || null;
  // Si le discount existait déjà (import de codes créés avant l'app), ne pas le supprimer en cas de rollback
  const discountWasNewlyCreated = !discountResult.alreadyExisted;

  try {
    // 2. GESTION CLIENT (Création ou Tag + Metafields) — non-bloquant
    try {
      const clientResult = await ensureCustomerPro(
        admin,
        fields.email,
        fields.first_name || "",
        fields.last_name || "",
        fields.profession,
        fields.adresse,
      );
      if (clientResult.success) {
        customerIdToSave = clientResult.customerId
          ? String(clientResult.customerId)
          : "";
      } else {
        console.warn("⚠️ [CLIENT] Sync client échoué (non-bloquant):", clientResult.error);
      }
    } catch (clientErr) {
      console.warn("⚠️ [CLIENT] Sync client exception (non-bloquant):", clientErr);
    }

    // Fallback : si ensureCustomerPro n'a pas pu résoudre l'ID (Protected Data),
    // utiliser le customer_id fourni directement (ex: depuis la page validation)
    if (!customerIdToSave && fields.customer_id) {
      customerIdToSave = String(fields.customer_id);
      console.log("[CLIENT] Fallback customer_id depuis fields:", customerIdToSave);
    }

    // 3. CRÉATION MÉTAOBJET
    const fieldsInput = [
      { key: "identification", value: String(fields.identification) },
      { key: "first_name", value: String(fields.first_name || "") },
      { key: "last_name", value: String(fields.last_name || "") },
      { key: "email", value: String(fields.email) },
      { key: "code", value: String(fields.code) },
      { key: "montant", value: String(fields.montant) },
      { key: "type", value: String(fields.type) },
      { key: "discount_id", value: discountIdCreated || "" },
      { key: "status", value: "true" },
      { key: "customer_id", value: customerIdToSave },
      { key: "profession", value: String(fields.profession || "") },
      { key: "adresse", value: String(fields.adresse || "") },
      { key: "cache_revenue", value: "0" },
      { key: "cache_orders_count", value: "0" },
      { key: "cache_credit_earned", value: "0" },
      { key: "cache_ca_remainder", value: "0" },
    ];

    const mutation = `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id }, userErrors { field message } } }`;
    const handle = String(fields.identification || fields.email).toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 64);
    const response = await admin.graphql(mutation, {
      variables: {
        metaobject: {
          type: METAOBJECT_TYPE,
          handle,
          fields: fieldsInput,
          capabilities: { publishable: { status: "ACTIVE" } },
        },
      },
    });
    const data = (await response.json()) as any;

    if (data.data?.metaobjectCreate?.userErrors?.length > 0) {
      console.error("[CREATE] metaobjectCreate userErrors:", JSON.stringify(data.data.metaobjectCreate.userErrors));
      console.error("[CREATE] fieldsInput:", JSON.stringify(fieldsInput));
      console.error("[CREATE] handle:", handle);
      throw new Error(data.data.metaobjectCreate.userErrors[0].message);
    }

    // 4. Mise à jour metafield code_promo sur la fiche client (non-bloquant)
    if (customerIdToSave) {
      try {
        await updateCustomerProMetafields(admin, customerIdToSave, {
          code_promo: String(fields.code),
        });
      } catch (mfErr) {
        console.warn("⚠️ [CLIENT] Metafield code_promo non mis à jour (non-bloquant):", mfErr);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("❌ ÉCHEC TRANSACTION. Démarrage Rollback...", error);

    // ROLLBACK : Supprimer le code promo uniquement s'il a été créé par cette transaction
    // (ne pas supprimer un discount préexistant récupéré lors d'un import)
    if (discountIdCreated && discountWasNewlyCreated) {
      console.log(
        `🗑 Rollback: Suppression du code promo ${discountIdCreated}`,
      );
      await deleteShopifyDiscount(admin, discountIdCreated);
    }

    return {
      success: false,
      error: "Annulation complète suite à erreur : " + String(error),
    };
  }
}

// --- UPDATE (CORRIGÉ : SYNCHRO NOM ET EMAIL) ---
export async function updateMetaobjectEntry(
  admin: AdminApiContext,
  id: string,
  fields: any,
) {
  console.log(`🔄 Update demandé pour ${id}`, fields);

  // 1. Récupérer les anciennes valeurs
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  let oldData: any = {};

  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = (await r.json()) as any;
    const currentFields = d.data?.metaobject?.fields || [];
    currentFields.forEach((f: any) => {
      oldData[f.key] = f.value;
    });
  } catch (e) {
    return {
      success: false,
      error: "Impossible de lire l'entrée avant update",
    };
  }

  const mergedFirstName = fields.first_name !== undefined ? fields.first_name : (oldData.first_name || "");
  const mergedLastName = fields.last_name !== undefined ? fields.last_name : (oldData.last_name || "");
  const mergedFullName = `${mergedFirstName} ${mergedLastName}`.trim();
  const mergedCode = fields.code || oldData.code;
  const mergedMontant =
    fields.montant !== undefined
      ? fields.montant
      : oldData.montant
        ? parseFloat(oldData.montant)
        : 0;
  const mergedType = fields.type || oldData.type;

  // 2. Mise à jour du Code Promo
  if (oldData.discount_id) {
    if (fields.first_name !== undefined || fields.last_name !== undefined || fields.code || fields.montant || fields.type) {
      const discountName = `Code promo Pro Sante - ${mergedFullName}`;
      await updateShopifyDiscount(admin, oldData.discount_id, {
        code: mergedCode,
        montant: mergedMontant,
        type: mergedType,
        name: discountName,
      });
    }

    if (fields.status !== undefined) {
      const isActive = fields.status === true || fields.status === "true";
      await toggleShopifyDiscount(admin, oldData.discount_id, isActive);
    }
  }

  // 3. Mise à jour du Client Shopify
  // On met à jour si l'un des champs synchronisés change
  if (oldData.customer_id) {
    const hasEmailChanged =
      fields.email &&
      fields.email.trim().toLowerCase() !==
        (oldData.email || "").trim().toLowerCase();
    const hasFirstNameChanged = fields.first_name !== undefined && fields.first_name !== oldData.first_name;
    const hasLastNameChanged = fields.last_name !== undefined && fields.last_name !== oldData.last_name;
    const hasProfessionChanged =
      fields.profession !== undefined &&
      fields.profession !== oldData.profession;
    const hasAdresseChanged =
      fields.adresse !== undefined && fields.adresse !== oldData.adresse;

    if (
      hasEmailChanged ||
      hasFirstNameChanged ||
      hasLastNameChanged ||
      hasProfessionChanged ||
      hasAdresseChanged
    ) {
      console.log(
        `👤 Changement infos client détecté (${[hasEmailChanged && "Email", (hasFirstNameChanged || hasLastNameChanged) && "Nom", hasProfessionChanged && "Profession", hasAdresseChanged && "Adresse"].filter(Boolean).join(", ")}). Mise à jour Shopify...`,
      );

      const emailToUse = fields.email || oldData.email;
      const firstNameToUse = fields.first_name !== undefined ? fields.first_name : (oldData.first_name || "");
      const lastNameToUse = fields.last_name !== undefined ? fields.last_name : (oldData.last_name || "");
      const professionToUse =
        fields.profession !== undefined
          ? fields.profession
          : oldData.profession;
      const adresseToUse =
        fields.adresse !== undefined ? fields.adresse : oldData.adresse;

      try {
        const updateClientResult = await updateCustomerInShopify(
          admin,
          oldData.customer_id,
          hasEmailChanged ? emailToUse : undefined,
          (hasFirstNameChanged || hasLastNameChanged) ? firstNameToUse : undefined,
          (hasFirstNameChanged || hasLastNameChanged) ? lastNameToUse : undefined,
          professionToUse,
          adresseToUse,
        );
        if (updateClientResult.success) {
          console.log("✅ Client Shopify mis à jour (Infos + Adresse physique).");
        } else {
          console.warn("⚠️ [CLIENT] Update client échoué (non-bloquant):", updateClientResult.error);
        }
      } catch (clientErr) {
        console.warn("⚠️ [CLIENT] Update client exception (non-bloquant):", clientErr);
      }
    }
  }

  // 4. Mise à jour du Métaobjet
  const fieldsInput: any[] = [];
  if (fields.identification)
    fieldsInput.push({
      key: "identification",
      value: String(fields.identification),
    });
  if (fields.first_name !== undefined)
    fieldsInput.push({ key: "first_name", value: String(fields.first_name) });
  if (fields.last_name !== undefined)
    fieldsInput.push({ key: "last_name", value: String(fields.last_name) });
  if (fields.email)
    fieldsInput.push({ key: "email", value: String(fields.email) });
  if (fields.code)
    fieldsInput.push({ key: "code", value: String(fields.code) });
  if (fields.montant)
    fieldsInput.push({ key: "montant", value: String(fields.montant) });
  if (fields.type)
    fieldsInput.push({ key: "type", value: String(fields.type) });
  if (fields.status !== undefined)
    fieldsInput.push({ key: "status", value: String(fields.status) });
  if (fields.profession !== undefined)
    fieldsInput.push({ key: "profession", value: String(fields.profession) });
  if (fields.adresse !== undefined)
    fieldsInput.push({ key: "adresse", value: String(fields.adresse) });

  const mutation = `mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { userErrors { field message } } }`;

  try {
    const r = await admin.graphql(mutation, {
      variables: { id, metaobject: { fields: fieldsInput } },
    });
    const d = (await r.json()) as any;
    if (d.data?.metaobjectUpdate?.userErrors?.length > 0)
      return {
        success: false,
        error: d.data.metaobjectUpdate.userErrors[0].message,
      };

    // Mise à jour metafield code_promo si le code a changé
    const codeChanged = fields.code && fields.code !== oldData.code;
    if (codeChanged && oldData.customer_id) {
      try {
        await updateCustomerProMetafields(admin, oldData.customer_id, {
          code_promo: String(mergedCode),
        });
      } catch (mfErr) {
        console.warn("⚠️ [CLIENT] Metafield code_promo non mis à jour (non-bloquant):", mfErr);
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// --- DELETE ENTREE SIMPLE ---
export async function deleteMetaobjectEntry(
  admin: AdminApiContext,
  id: string,
) {
  const currentEntryQuery = `query($id: ID!) { metaobject(id: $id) { fields { key, value } } }`;
  try {
    const r = await admin.graphql(currentEntryQuery, { variables: { id } });
    const d = (await r.json()) as any;
    const fields = d.data?.metaobject?.fields || [];

    const linkedCustomerId = fields.find(
      (f: any) => f.key === "customer_id",
    )?.value;
    const entryEmail = fields.find((f: any) => f.key === "email")?.value;
    const existingDiscountId = fields.find(
      (f: any) => f.key === "discount_id",
    )?.value;

    try {
      if (linkedCustomerId) await removeCustomerProTag(admin, linkedCustomerId);
      else if (entryEmail) await removeCustomerProTag(admin, entryEmail);
    } catch (tagErr) {
      console.warn("⚠️ [CLIENT] Suppression tag client échouée (non-bloquant):", tagErr);
    }

    // Supprimer le metafield code_promo du client associé (non-bloquant)
    if (linkedCustomerId) {
      try {
        await deleteCustomerCodePromo(admin, linkedCustomerId);
      } catch (mfErr) {
        console.warn("⚠️ [CLIENT] Suppression metafield code_promo échouée (non-bloquant):", mfErr);
      }
    }

    if (existingDiscountId)
      await deleteShopifyDiscount(admin, existingDiscountId);

    const mutation = `mutation metaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { userErrors { field message } } }`;
    await admin.graphql(mutation, { variables: { id } });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// --- DELETE TOTAL ---
export async function destroyMetaobjectStructure(admin: AdminApiContext) {
  console.log("☢️ DÉMARRAGE SUPPRESSION TOTALE...");
  try {
    const queryDefinitions = `query { metaobjectDefinitions(first: 250) { edges { node { id, type } } } }`;
    const rDef = await admin.graphql(queryDefinitions);
    const dDef = (await rDef.json()) as any;

    const definitionNode = dDef.data?.metaobjectDefinitions?.edges?.find(
      (e: any) => e.node.type === METAOBJECT_TYPE,
    )?.node;
    const definitionId = definitionNode?.id;

    const { entries } = await getMetaobjectEntries(admin);
    console.log(`🧹 Nettoyage de ${entries.length} entrées...`);
    for (const entry of entries) {
      await deleteMetaobjectEntry(admin, entry.id);
    }

    if (definitionId) {
      console.log(`🗑 Suppression Définition : ${definitionId}`);
      const mutation = `mutation metaobjectDefinitionDelete($id: ID!) { metaobjectDefinitionDelete(id: $id) { userErrors { field message } } }`;
      const rDel = await admin.graphql(mutation, {
        variables: { id: definitionId },
      });
      const dDel = (await rDel.json()) as any;
      if (dDel.data?.metaobjectDefinitionDelete?.userErrors?.length > 0) {
        console.warn(
          "Info Delete Def:",
          dDel.data.metaobjectDefinitionDelete.userErrors,
        );
      }
    }
    return { success: true };
  } catch (error) {
    console.error("❌ CRASH DESTROY:", error);
    return { success: false, error: String(error) };
  }
}
