import { useLoaderData, Link } from "react-router";
import { Page, Layout, Card, DataTable, Badge, Text, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  
  // 1. On récupère nos entrées métaobjets
  const { entries } = await getMetaobjectEntries(admin);

  // 2. Pour chaque entrée, on va vérifier si le discount_id est valide (optionnel mais propre)
  // Pour l'instant, on affiche simplement les données stockées
  return { entries };
};

export default function AdditionalPage() {
  const { entries } = useLoaderData<typeof loader>();

  const rows = entries.map((entry: any) => [
    <Text as="span" fontWeight="bold">{entry.name}</Text>,
    <Badge tone="info">{entry.code}</Badge>,
    <Text as="span">{entry.montant} {entry.type}</Text>,
    <Text as="span" tone="subdued">Code promo Pro Sante - {entry.name}</Text>,
    entry.discount_id ? (
      <Badge tone="success">Actif & Synchronisé</Badge>
    ) : (
      <Badge tone="warning">Non lié (Ancien)</Badge>
    )
  ]);

  return (
    <Page title="Vue d'ensemble des Codes Promo">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Codes Promo générés ({entries.length})
                </Text>
                <p>
                  Cette page liste tous les codes promo créés automatiquement via la gestion des Pros de Santé.
                  Si vous modifiez un pro dans la page d'accueil, le code promo ici sera mis à jour.
                </p>
              </BlockStack>
            </Card>

            <Card>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Nom du Pro", "Code Promo", "Valeur", "Nom Technique (Shopify)", "Statut Sync"]}
                rows={rows}
              />
            </Card>
            
            <div style={{textAlign: "center", marginTop: "20px"}}>
               <Link to="/app" style={{textDecoration: "none", color: "#008060", fontWeight: "bold"}}>
                 ← Retour à la gestion des Pros
               </Link>
            </div>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}