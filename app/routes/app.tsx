import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { ErrorDisplay } from "../components/ErrorDisplay";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={{}}>
        {/* Note: s-app-nav semble être un composant personnalisé ou web component */}
        <s-app-nav>
          <s-link href="/app">Gestion Pros de Santé</s-link>
          <s-link href="/app/codes_promo">Gestion Codes Promo</s-link>
          <s-link href="/app/clients">Gestion Clients Pros</s-link>
          <s-link href="/app/tutoriel">Tutoriel</s-link>
          <s-link href="/app/analytique">Analytique</s-link>
        </s-app-nav>
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const { apiKey } = useLoaderData<typeof loader>();
  
  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={{}}>
        <ErrorDisplay error={error} />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};