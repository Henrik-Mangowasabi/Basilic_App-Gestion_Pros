import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, redirect, useSearchParams } from "react-router";
import { Page, Layout, Card, Text, Banner, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { checkMetaobjectStatus, createMetaobject } from "../lib/metaobject.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);
  
  // Vérifier si on vient d'une création réussie
  const url = new URL(request.url);
  const success = url.searchParams.get("success");
  const error = url.searchParams.get("error");
  
  return { status, success, error };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const result = await createMetaobject(admin);
  
  if (result.success) {
    // Attendre un peu pour que Shopify propage la création
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Vérifier que la création a bien été effectuée
    const status = await checkMetaobjectStatus(admin);
    if (status.exists) {
      // Rediriger avec un paramètre de succès
      return redirect("/app?success=created");
    } else {
      // Si après 2 secondes le métaobjet n'existe toujours pas, c'est une erreur
      return redirect("/app?error=propagation");
    }
  }
  
  // En cas d'erreur, rediriger avec le message d'erreur
  const errorMessage = encodeURIComponent(result.error || "Erreur inconnue lors de la création");
  return redirect(`/app?error=${errorMessage}`);
};

export default function Index() {
  const { status, success, error } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Page title="MM Gestion Pros Santé">
      <Layout>
        <Layout.Section>
          {/* Message de succès après création */}
          {success === "created" && (
            <Banner
              tone="success"
              title="Structure créée avec succès !"
              onDismiss={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.delete("success");
                setSearchParams(newParams);
              }}
            >
              <p>Le métaobjet &quot;MM Pro de santé&quot; a été créé avec succès. La structure est maintenant prête !</p>
            </Banner>
          )}
          
          {/* Message d'erreur */}
          {error && (
            <Banner
              tone="critical"
              title="Erreur lors de la création"
              onDismiss={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.delete("error");
                setSearchParams(newParams);
              }}
            >
              <p>
                {error === "propagation"
                  ? "La structure a été créée mais n'a pas pu être vérifiée. Veuillez rafraîchir la page."
                  : decodeURIComponent(error)}
              </p>
            </Banner>
          )}
          
          {/* Message si la structure existe déjà */}
          {status.exists && !success && (
            <Banner tone="success" title="Structure prête">
              <p>Le métaobjet &quot;MM Pro de santé&quot; existe. Structure prête !</p>
            </Banner>
          )}
          
          <Card>
            {status.exists ? (
              <Text as="p" variant="bodyMd">
                Structure prête
              </Text>
            ) : (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Le métaobjet &quot;MM Pro de santé&quot; n&apos;existe pas encore.
                </Text>
                <div style={{ marginTop: "1rem" }}>
                  <Form method="post">
                    <Button submit variant="primary" size="large">
                      Créer la structure
                    </Button>
                  </Form>
                </div>
              </>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}