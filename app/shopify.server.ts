import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import path from "path";

const sessionDb = new SQLiteSessionStorage(
  path.resolve(process.cwd(), "sessions.db")
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY?.trim(),
  apiSecretKey: process.env.SHOPIFY_API_SECRET?.trim() || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: sessionDb,
  distribution: AppDistribution.AppStore,
  future: {},
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
