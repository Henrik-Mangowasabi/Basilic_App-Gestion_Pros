import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { ErrorDisplay } from "../components/ErrorDisplay";
import { NavBar } from "../components/NavBar";
import { EditModeProvider, useEditMode } from "../context/EditModeContext";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function AppInner() {
  const { toast, dismissToast } = useEditMode();
  return (
    <>
      <div className="app-layout">
        <NavBar />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
      {toast && (
        <div className={`toast toast--${toast.type}`} role="alert" aria-live="polite">
          <div className="toast__icon-wrapper">
            {toast.type === "success" && (
              <svg className="toast__icon toast__icon--success" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="toast__icon toast__icon--error" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
            {toast.type === "info" && (
              <svg className="toast__icon toast__icon--info" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div className="toast__content">
            <span className="toast__title">{toast.title}</span>
            <span className="toast__message">{toast.msg}</span>
          </div>
          <button type="button" className="toast__close" onClick={dismissToast} aria-label="Fermer">✕</button>
        </div>
      )}
    </>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={{}}>
        <s-app-nav>
          <s-link href="/app">Gestion Pros de Santé</s-link>
          <s-link href="/app/analytique">Analytique</s-link>
          <s-link href="/app/validation">Validation Pros</s-link>
          <s-link href="/app/tutoriel">Tutoriel</s-link>
        </s-app-nav>
        <EditModeProvider>
          <AppInner />
        </EditModeProvider>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const loaderData = useLoaderData<typeof loader>();
  const apiKey = loaderData?.apiKey || "";

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
