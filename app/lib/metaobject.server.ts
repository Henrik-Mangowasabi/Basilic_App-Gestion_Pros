import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

/**
 * Vérifie si le métaobjet existe
 */
export async function checkMetaobjectExists(admin: AdminApiContext): Promise<boolean> {
  // Utiliser une requête qui liste tous les métaobjets pour être sûr
  const query = `
    query {
      metaobjectDefinitions(first: 250) {
        edges {
          node {
            id
            name
            type
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query);
    const data = await response.json() as {
      data?: {
        metaobjectDefinitions?: {
          edges?: Array<{
            node?: {
              id: string;
              name: string;
              type: string;
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };
    
    if (data.errors) {
      console.error("Erreurs GraphQL:", data.errors);
      return false;
    }
    
    const definitions = data.data?.metaobjectDefinitions?.edges || [];
    const exists = definitions.some(
      edge => edge.node?.type === METAOBJECT_TYPE || edge.node?.name === METAOBJECT_NAME
    );
    
    return exists;
  } catch (error) {
    console.error("Erreur lors de la vérification du métaobjet:", error);
    return false;
  }
}

/**
 * Crée le métaobjet avec tous ses champs
 */
export async function createMetaobject(admin: AdminApiContext): Promise<{ success: boolean; error?: string }> {
  // Vérifier d'abord si le métaobjet existe déjà
  const exists = await checkMetaobjectExists(admin);
  if (exists) {
    return { success: true }; // Déjà créé, pas besoin de le recréer
  }
  
  // Création des définitions de champs une par une
  const fieldDefinitions = [
    {
      name: "Identification",
      key: "identification",
      type: "single_line_text_field",
      required: true,
      unique: true
    },
    {
      name: "Name",
      key: "name",
      type: "single_line_text_field",
      required: true
    },
    {
      name: "Email",
      key: "email",
      type: "single_line_text_field",
      required: true
    },
    {
      name: "Code Name",
      key: "code",
      type: "single_line_text_field",
      required: true
    },
    {
      name: "Montant",
      key: "montant",
      type: "number_decimal",
      required: true
    },
    {
      name: "Type",
      key: "type",
      type: "single_line_text_field",
      required: true,
      choices: ["%", "€"]
    }
  ];

  // Mutation pour créer le métaobjet
  const mutation = `
    mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition {
          id
          name
          type
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Construction des fieldDefinitions au format GraphQL avec validations choices
  const graphqlFieldDefinitions = fieldDefinitions.map(field => {
    const base: {
      name: string;
      key: string;
      required: boolean;
      type?: string;
      validations?: Array<{ name: string; value: string }>;
    } = {
      name: field.name,
      key: field.key,
      required: field.required
    };

    if (field.type === "single_line_text_field") {
      base.type = "single_line_text_field";
      
      // Ajouter les choix si définis - format correct : valeur en JSON string
      if (field.choices && field.choices.length > 0) {
        base.validations = [
          {
            name: "choices",
            value: JSON.stringify(field.choices) // Format: "[\"%\", \"€\"]"
          }
        ];
      }
    } else if (field.type === "number_decimal") {
      base.type = "number_decimal";
    }
    
    return base;
  });

  const variables = {
    definition: {
      name: METAOBJECT_NAME,
      type: METAOBJECT_TYPE,
      fieldDefinitions: graphqlFieldDefinitions,
      capabilities: {
        publishable: {
          enabled: true
        }
      }
    }
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        metaobjectDefinitionCreate?: {
          metaobjectDefinition?: { id: string; name: string; type: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };
    
    if (data.errors) {
      return { success: false, error: JSON.stringify(data.errors) };
    }
    
    if (data.data?.metaobjectDefinitionCreate?.userErrors && data.data.metaobjectDefinitionCreate.userErrors.length > 0) {
      const errors = data.data.metaobjectDefinitionCreate.userErrors;
      return { 
        success: false, 
        error: errors.map((e: { message: string }) => e.message).join(", ") 
      };
    }
    
    return { success: !!data.data?.metaobjectDefinitionCreate?.metaobjectDefinition };
  } catch (error) {
    console.error("Erreur lors de la création du métaobjet:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Erreur inconnue" 
    };
  }
}

/**
 * Vérifie si le métaobjet existe (sans le créer)
 */
export async function checkMetaobjectStatus(admin: AdminApiContext): Promise<{
  exists: boolean;
  error?: string;
}> {
  try {
    const exists = await checkMetaobjectExists(admin);
    return { exists };
  } catch (error) {
    console.error("Erreur dans checkMetaobjectStatus:", error);
    return { 
      exists: false, 
      error: error instanceof Error ? error.message : "Erreur inconnue" 
    };
  }
}

/**
 * Crée une nouvelle entrée de métaobjet
 */
export async function createMetaobjectEntry(
  admin: AdminApiContext,
  fields: {
    identification: string;
    name: string;
    email: string;
    code: string;
    montant: number;
    type: string;
  }
): Promise<{ success: boolean; error?: string }> {
  // Validation des champs requis (identification est maintenant auto-générée si vide)
  if (!fields.identification || fields.identification.trim() === "") {
    // Auto-générer si toujours vide (ne devrait pas arriver)
    fields.identification = `ID_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  if (!fields.name || fields.name.trim() === "") {
    return { success: false, error: "Le champ Name est requis" };
  }
  if (!fields.email || fields.email.trim() === "") {
    return { success: false, error: "Le champ Email est requis" };
  }
  if (!fields.code || fields.code.trim() === "") {
    return { success: false, error: "Le champ Code est requis" };
  }
  if (fields.montant === undefined || isNaN(fields.montant)) {
    return { success: false, error: "Le champ Montant est requis et doit être un nombre" };
  }
  if (!fields.type || fields.type.trim() === "") {
    return { success: false, error: "Le champ Type est requis" };
  }

  const mutation = `
    mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    metaobject: {
      type: METAOBJECT_TYPE,
      fields: [
        { key: "identification", value: fields.identification.trim() },
        { key: "name", value: fields.name.trim() },
        { key: "email", value: fields.email.trim() },
        { key: "code", value: fields.code.trim() },
        { key: "montant", value: String(fields.montant) },
        { key: "type", value: fields.type.trim() },
      ],
    },
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        metaobjectCreate?: {
          metaobject?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    if (data.errors) {
      const errorMessages = data.errors.map((e: { message: string }) => e.message).join(", ");
      return { success: false, error: `Erreur GraphQL: ${errorMessages}` };
    }

    if (data.data?.metaobjectCreate?.userErrors && data.data.metaobjectCreate.userErrors.length > 0) {
      const errors = data.data.metaobjectCreate.userErrors;
      const errorMessages = errors.map((e: { field: string[]; message: string }) => {
        const fieldName = e.field.join(".");
        return `${fieldName ? `Champ ${fieldName}: ` : ""}${e.message}`;
      }).join(" | ");
      return {
        success: false,
        error: errorMessages,
      };
    }

    return { success: !!data.data?.metaobjectCreate?.metaobject };
  } catch (error) {
    console.error("Erreur lors de la création de l'entrée:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

/**
 * Met à jour une entrée de métaobjet
 */
export async function updateMetaobjectEntry(
  admin: AdminApiContext,
  id: string,
  fields: {
    identification: string;
    name: string;
    email: string;
    code: string;
    montant: number;
    type: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const mutation = `
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Construire le tableau de champs - TOUS les champs doivent être envoyés pour éviter la suppression
  const fieldsArray: Array<{ key: string; value: string }> = [];
  
  // Toujours envoyer tous les champs (requis pour éviter la suppression par Shopify)
  fieldsArray.push({ key: "identification", value: String(fields.identification || "").trim() });
  fieldsArray.push({ key: "name", value: String(fields.name || "").trim() });
  fieldsArray.push({ key: "email", value: String(fields.email || "").trim() });
  fieldsArray.push({ key: "code", value: String(fields.code || "").trim() });
  if (!isNaN(fields.montant)) {
    fieldsArray.push({ key: "montant", value: String(fields.montant) });
  }
  fieldsArray.push({ key: "type", value: String(fields.type || "").trim() });

  const variables = {
    id,
    metaobject: {
      fields: fieldsArray,
    },
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        metaobjectUpdate?: {
          metaobject?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    if (data.errors) {
      const errorMessages = data.errors.map((e: { message: string }) => e.message).join(", ");
      return { success: false, error: `Erreur GraphQL: ${errorMessages}` };
    }

    if (data.data?.metaobjectUpdate?.userErrors && data.data.metaobjectUpdate.userErrors.length > 0) {
      const errors = data.data.metaobjectUpdate.userErrors;
      const errorMessages = errors.map((e: { field: string[]; message: string }) => {
        const fieldName = e.field.join(".");
        return `${fieldName ? `Champ ${fieldName}: ` : ""}${e.message}`;
      }).join(" | ");
      return {
        success: false,
        error: errorMessages,
      };
    }

    return { success: !!data.data?.metaobjectUpdate?.metaobject };
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'entrée:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

/**
 * Supprime une entrée de métaobjet
 */
export async function deleteMetaobjectEntry(
  admin: AdminApiContext,
  id: string
): Promise<{ success: boolean; error?: string }> {
  const mutation = `
    mutation metaobjectDelete($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = { id };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        metaobjectDelete?: {
          deletedId?: string;
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    if (data.errors) {
      return { success: false, error: JSON.stringify(data.errors) };
    }

    if (data.data?.metaobjectDelete?.userErrors && data.data.metaobjectDelete.userErrors.length > 0) {
      const errors = data.data.metaobjectDelete.userErrors;
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return { success: !!data.data?.metaobjectDelete?.deletedId };
  } catch (error) {
    console.error("Erreur lors de la suppression de l'entrée:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

/**
 * Récupère toutes les entrées du métaobjet
 */
export async function getMetaobjectEntries(admin: AdminApiContext): Promise<{
  entries: Array<{
    id: string;
    identification?: string;
    name?: string;
    email?: string;
    code?: string;
    montant?: number;
    type?: string;
  }>;
  error?: string;
}> {
  const query = `
    query {
      metaobjects(first: 250, type: "${METAOBJECT_TYPE}") {
        edges {
          node {
            id
            fields {
              key
              value
              type
            }
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query);
    const data = await response.json() as {
      data?: {
        metaobjects?: {
          edges?: Array<{
            node?: {
              id: string;
              fields?: Array<{
                key: string;
                value: string | number | null;
                type?: string;
              }>;
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors) {
      return { entries: [], error: data.errors.map(e => e.message).join(", ") };
    }

    const edges = data.data?.metaobjects?.edges || [];
    const entries = edges.map(edge => {
      const node = edge.node;
      if (!node) return null;

      const entry: {
        id: string;
        identification?: string;
        name?: string;
        email?: string;
        code?: string;
        montant?: number;
        type?: string;
      } = { id: node.id };

      // Debug: log les champs reçus
      console.log("Champs reçus pour l'entrée:", node.id, node.fields);

      // Debug: log tous les champs reçus
      console.log("Champs GraphQL reçus pour l'entrée:", node.id);
      console.log("Tous les champs:", JSON.stringify(node.fields, null, 2));

      node.fields?.forEach(field => {
        // Gérer les valeurs null/undefined
        if (field.value === null || field.value === undefined || field.value === "") {
          console.log(`Champ ${field.key} est vide ou null`);
          return; // Ignorer les valeurs null/vides
        }

        const stringValue = String(field.value).trim();
        if (!stringValue) {
          return; // Ignorer les chaînes vides après trim
        }

        if (field.key === "identification") {
          entry.identification = stringValue;
          console.log(`Identification définie: ${stringValue}`);
        } else if (field.key === "name") {
          entry.name = stringValue;
          console.log(`Name défini: ${stringValue}`);
        } else if (field.key === "email") {
          entry.email = stringValue;
          console.log(`Email défini: ${stringValue}`);
        } else if (field.key === "code") {
          entry.code = stringValue;
          console.log(`Code défini: ${stringValue}`);
        } else if (field.key === "montant") {
          const numValue = Number(field.value);
          if (!isNaN(numValue)) {
            entry.montant = numValue;
            console.log(`Montant défini: ${numValue}`);
          }
        } else if (field.key === "type") {
          entry.type = stringValue;
          console.log(`Type défini: ${stringValue}`);
        } else {
          console.log(`Champ inconnu ignoré: ${field.key} = ${field.value}`);
        }
      });

      // Debug: log l'entrée finale
      console.log("Entrée parsée:", entry);

      return entry;
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return { entries };
  } catch (error) {
    console.error("Erreur lors de la récupération des entrées:", error);
    return {
      entries: [],
      error: error instanceof Error ? error.message : "Erreur inconnue"
    };
  }
}

