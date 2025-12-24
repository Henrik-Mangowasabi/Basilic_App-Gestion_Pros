import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const METAOBJECT_TYPE = "mm_pro_de_sante";
const METAOBJECT_NAME = "MM Pro de santé";

/**
 * Vérifie si le métaobjet existe
 */
export async function checkMetaobjectExists(admin: AdminApiContext): Promise<boolean> {
  // Utiliser la méthode simple avec metaobjectDefinition
  const query = `
    query {
      metaobjectDefinition(type: "${METAOBJECT_TYPE}") {
        id
        name
        type
      }
    }
  `;

  try {
    const response = await admin.graphql(query);
    const data = await response.json() as {
      data?: {
        metaobjectDefinition?: {
          id: string;
          name: string;
          type: string;
        };
      };
    };
    return !!data.data?.metaobjectDefinition;
  } catch (error) {
    console.error("Erreur lors de la vérification du métaobjet:", error);
    return false;
  }
}

/**
 * Crée le métaobjet avec tous ses champs
 */
export async function createMetaobject(admin: AdminApiContext): Promise<{ success: boolean; error?: string }> {
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

  // Construction des fieldDefinitions au format GraphQL (sans validations pour éviter les erreurs)
  const graphqlFieldDefinitions = fieldDefinitions.map(field => {
    const base: {
      name: string;
      key: string;
      required: boolean;
      type?: string;
    } = {
      name: field.name,
      key: field.key,
      required: field.required
    };

    if (field.type === "single_line_text_field") {
      base.type = "single_line_text_field";
      // Les choix seront ajoutés manuellement dans l'interface Shopify pour l'instant
      // Le format GraphQL pour les choix nécessite une structure spécifique
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
    
    if (data.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
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

