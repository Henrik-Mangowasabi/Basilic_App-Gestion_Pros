import { Page, Layout, Card, Text } from "@shopify/polaris";

export function ErrorDisplay({ error }: { error: unknown }) {
  let detail = "Une erreur est survenue";
  if (error instanceof Error) {
    detail = `${error.name}: ${error.message}`;
  } else if (error instanceof Response) {
    detail = `Response ${error.status} ${error.statusText} — URL: ${error.url}`;
  } else if (typeof error === "string") {
    detail = error;
  } else {
    try { detail = JSON.stringify(error); } catch { detail = String(error); }
  }

  return (
    <Page title="Erreur">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {detail}
            </Text>
            {error instanceof Error && error.stack && (
              <Text as="p" variant="bodySm" tone="subdued">
                {error.stack.slice(0, 500)}
              </Text>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

