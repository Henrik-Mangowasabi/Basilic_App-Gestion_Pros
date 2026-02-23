import { Page, Layout, Card, Text, Button } from "@shopify/polaris";

export function ErrorDisplay({ error }: { error: unknown }) {
  let detail = "Une erreur est survenue. Veuillez réessayer.";
  if (error instanceof Error) {
    detail = error.message || detail;
  } else if (error instanceof Response) {
    detail = `Erreur ${error.status} — veuillez recharger la page.`;
  } else if (typeof error === "string") {
    detail = error;
  }

  return (
    <Page title="Une erreur est survenue">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {detail}
            </Text>
            <div style={{ marginTop: "16px" }}>
              <Button onClick={() => window.location.reload()}>Recharger la page</Button>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

