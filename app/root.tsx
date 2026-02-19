import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import polarisStylesUrl from "@shopify/polaris/build/esm/styles.css?url";
import uiKitStylesUrl from "./styles/ui-kit.css?url";
import basilicStylesUrl from "./styles/basilic-ui.css?url";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="stylesheet" href={polarisStylesUrl} />
        <link rel="stylesheet" href={uiKitStylesUrl} />
        <link rel="stylesheet" href={basilicStylesUrl} />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
