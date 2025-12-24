import { Page, Layout, Card, Text } from "@shopify/polaris";

export function ErrorDisplay({ error }: { error: unknown }) {
  return (
    <Page title="Erreur">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {error instanceof Error ? error.message : "Une erreur est survenue"}
            </Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

