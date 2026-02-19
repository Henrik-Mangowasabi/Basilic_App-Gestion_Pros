import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import {
  getMetaobjectEntries,
  checkMetaobjectStatus,
} from "../lib/metaobject.server";
import { Pagination } from "../components/Pagination";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const startDateStr = url.searchParams.get("startDate");
  const endDateStr = url.searchParams.get("endDate");
  const selectedProfessions = url.searchParams.getAll("profession");

  const status = await checkMetaobjectStatus(admin);
  if (!status.exists)
    return {
      stats: null,
      ranking: [],
      isInitialized: false,
      config: null,
      filters: { startDate: "", endDate: "" },
      chartData: [] as { month: string; count: number; ghost?: boolean; key: string }[],
      professionList: [] as string[],
      selectedProfessions: [] as string[],
      shopDomain,
    };

  const result = await getMetaobjectEntries(admin);
  const entries = result.entries || [];

  const professionList: string[] = [...new Set<string>(entries.map((e: any) => e.profession).filter(Boolean) as string[])].sort();
  const isProfFiltered = selectedProfessions.length > 0;
  const isDateFiltered = !!(startDateStr || endDateStr);

  // Détecte si le filtre correspond exactement à un mois complet dans la fenêtre des 6 derniers mois
  const isFullMonthFilter = (() => {
    if (!startDateStr || !endDateStr) return false;
    const start = new Date(startDateStr + "T00:00:00");
    if (start.getDate() !== 1) return false;
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    if (endDateStr !== lastDayStr) return false;
    // Vérifier que ce mois est dans la fenêtre des 6 derniers mois
    const today = new Date();
    const windowBegin = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    return start >= windowBegin;
  })();

  const profEntriesFiltered = isProfFiltered
    ? entries.filter((e: any) => selectedProfessions.includes(e.profession))
    : entries;
  const allowedCodes = new Set<string>(profEntriesFiltered.map((e: any) => e.code).filter(Boolean));

  let stats = {
    totalOrders: 0,
    totalRevenue: 0,
    activePros: profEntriesFiltered.filter((entry: any) => entry.status !== false).length,
    totalPros: profEntriesFiltered.length,
    isFiltered: isDateFiltered || isProfFiltered,
    isDateFiltered,
    isFullMonthFilter,
  };

  let ranking: any[] = [];
  let chartData: { month: string; count: number; ghost?: boolean; key: string }[] = [];
  const MONTH_ABBR = ["JAN.","FÉV.","MAR.","AVR.","MAI","JUIN","JUIL.","AOÛ.","SEPT.","OCT.","NOV.","DÉC."];

  if (isDateFiltered) {
    const proStats = new Map<string, { revenue: number; count: number }>();

    const query = `#graphql
      query getOrdersByDate($queryString: String!, $cursor: String) {
        orders(first: 250, query: $queryString, after: $cursor) {
          edges {
            node {
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              discountCodes
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      let hasNextPage = true;
      let cursor = null;
      let pagesLoaded = 0;
      const maxPages = 4; // On limite à 1000 commandes (4x250) pour garder une page rapide
      const filteredMonthlyMap = new Map<string, { month: string; count: number; ghost?: boolean }>();

      // Toujours afficher les 6 derniers mois à partir d'aujourd'hui
      const today = new Date();
      const windowBegin = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      const windowBeginStr = `${windowBegin.getFullYear()}-${String(windowBegin.getMonth() + 1).padStart(2, "0")}-01`;

      // Pré-remplir les 6 mois : ghost si hors plage filtrée, actif sinon
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const mFirst = `${mk}-01`;
        const mLast = `${mk}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
        const isInRange = mFirst <= (endDateStr ?? "9999-12-31") && mLast >= (startDateStr ?? "0000-01-01");
        filteredMonthlyMap.set(mk, { month: MONTH_ABBR[d.getMonth()], count: 0, ghost: !isInRange });
      }

      // Requête couvrant les 6 mois de la fenêtre
      const extendedQueryString = `created_at:>=${windowBeginStr} AND discount_code:*`;

      while (hasNextPage && pagesLoaded < maxPages) {
        const response = await admin.graphql(query, { // eslint-disable-line @typescript-eslint/no-explicit-any
          variables: { queryString: extendedQueryString, cursor },
        });
        const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const ordersEdges = data.data?.orders?.edges || [];

        ordersEdges.forEach((edge: any) => {
          const order = edge.node;
          const createdAt = new Date(order.createdAt);
          const revenue = parseFloat(order.totalPriceSet.shopMoney.amount);
          const codesUsed = order.discountCodes || [];

          // Date de la commande en format YYYY-MM-DD pour comparaison
          const orderDateStr = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
          const isInFilterRange = orderDateStr >= (startDateStr ?? "") && orderDateStr <= (endDateStr ?? "9999-12-31");

          // proStats et stats.totalOrders : uniquement pour les commandes dans la plage filtrée
          if (isInFilterRange && codesUsed.length > 0) {
            codesUsed.filter((c: string) => allowedCodes.has(c)).forEach((code: string) => {
              const current = proStats.get(code) || { revenue: 0, count: 0 };
              proStats.set(code, {
                revenue: current.revenue + revenue,
                count: current.count + 1,
              });
              stats.totalRevenue += revenue;
              stats.totalOrders += 1;
            });
          }

          // Chart : toutes les commandes (ghost + actives), filtrées par pros enregistrés
          const relevantChartCodes = codesUsed.filter((c: string) => allowedCodes.has(c));
          if (relevantChartCodes.length > 0) {
            const mk = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
            const isGhost = filteredMonthlyMap.get(mk)?.ghost ?? !isInFilterRange;
            const ex = filteredMonthlyMap.get(mk) || { month: MONTH_ABBR[createdAt.getMonth()], count: 0, ghost: isGhost };
            filteredMonthlyMap.set(mk, { ...ex, count: ex.count + 1 });
          }
        });

        const pageInfo = data.data?.orders?.pageInfo as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        hasNextPage = pageInfo?.hasNextPage;
        cursor = pageInfo?.endCursor;
        pagesLoaded++;
      }

      chartData = [...filteredMonthlyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ ...v, key: k }));

      ranking = profEntriesFiltered
        .map((entry: any) => {
          const periodData = proStats.get(entry.code) || {
            revenue: 0,
            count: 0,
          };
          return {
            id: entry.id,
            name: [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.name || "Sans nom",
            profession: entry.profession || "-",
            code: entry.code || "-",
            value: entry.montant != null ? `${entry.montant} ${entry.type || "%"}` : "-",
            revenue: periodData.revenue,
            ordersCount: periodData.count,
            customerId: entry.customer_id || null,
          };
        })
        .sort((a: any, b: any) => b.revenue - a.revenue);
    } catch (e) {
      console.error("Erreur filtrage analytique:", e);
    }
  } else {
    // LOGIQUE PAR DÉFAUT : requête Shopify directe (toutes les commandes)
    const proStats = new Map<string, { revenue: number; count: number }>();

    try {
      const allOrdersQuery = `#graphql
        query getAllOrders($queryString: String!, $cursor: String) {
          orders(first: 250, query: $queryString, after: $cursor) {
            edges {
              node {
                totalPriceSet { shopMoney { amount } }
                discountCodes
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      const currentYear = new Date().getFullYear();
      let hasNextPage = true;
      let cursor = null;
      while (hasNextPage) {
        const response = await admin.graphql(allOrdersQuery, { // eslint-disable-line @typescript-eslint/no-explicit-any
          variables: { queryString: `created_at:>=${currentYear}-01-01 AND discount_code:*`, cursor },
        });
        const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const edge of data.data?.orders?.edges || []) {
          const revenue = parseFloat(edge.node.totalPriceSet.shopMoney.amount);
          const codesUsed: string[] = edge.node.discountCodes || [];
          const relevantCodes = codesUsed.filter((c) => allowedCodes.has(c));
          relevantCodes.forEach((code) => {
            const cur = proStats.get(code) || { revenue: 0, count: 0 };
            proStats.set(code, { revenue: cur.revenue + revenue, count: cur.count + 1 });
            stats.totalRevenue += revenue;
            stats.totalOrders += 1;
          });
        }
        const pageInfo = data.data?.orders?.pageInfo as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        hasNextPage = pageInfo?.hasNextPage;
        cursor = pageInfo?.endCursor;
      }
    } catch (e) {
      console.error("Erreur chargement stats globales:", e);
    }

    ranking = profEntriesFiltered
      .map((entry: any) => {
        const periodData = proStats.get(entry.code) || { revenue: 0, count: 0 };
        return {
          id: entry.id,
          name: [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.name || "Sans nom",
          profession: entry.profession || "-",
          code: entry.code || "-",
          value: entry.montant != null ? `${entry.montant} ${entry.type || "%"}` : "-",
          revenue: periodData.revenue,
          ordersCount: periodData.count,
          customerId: entry.customer_id || null,
        };
      })
      .sort((a: any, b: any) => (b.revenue || 0) - (a.revenue || 0));

    // --- Sparkline : commandes par mois (6 derniers mois) ---
    const chartNow = new Date();
    const monthlyMap = new Map<string, { month: string; count: number; ghost?: boolean }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(chartNow.getFullYear(), chartNow.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyMap.set(k, { month: MONTH_ABBR[d.getMonth()], count: 0 });
    }
    try {
      const sixAgo = new Date(chartNow.getFullYear(), chartNow.getMonth() - 5, 1);
      const sixAgoStr = `${sixAgo.getFullYear()}-${String(sixAgo.getMonth() + 1).padStart(2, "0")}-01`;
      const mq = `#graphql
        query GetMonthlySparks($qs: String!, $cursor: String) {
          orders(first: 250, query: $qs, after: $cursor) {
            edges { node { createdAt discountCodes } }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      let hasMore = true;
      let cursor = null;
      let pages = 0;
      while (hasMore && pages < 4) {
        const resp = await admin.graphql(mq, {
          variables: { qs: `created_at:>=${sixAgoStr} AND discount_code:*`, cursor },
        });
        const mData = await resp.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const edge of mData.data?.orders?.edges || []) {
          const edgeCodes = edge.node.discountCodes || [];
          const relevantCodes = edgeCodes.filter((c: string) => allowedCodes.has(c));
          if (relevantCodes.length > 0) {
            const createdAt = new Date(edge.node.createdAt);
            const k = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
            const ex = monthlyMap.get(k);
            if (ex) monthlyMap.set(k, { ...ex, count: ex.count + 1 });
          }
        }
        hasMore = !!mData.data?.orders?.pageInfo?.hasNextPage;
        cursor = mData.data?.orders?.pageInfo?.endCursor ?? null;
        pages++;
      }
    } catch (e) {
      console.error("Chart data error:", e);
    }
    chartData = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ ...v, key: k }));
  }

  return {
    stats,
    ranking,
    isInitialized: true,
    filters: { startDate: startDateStr || "", endDate: endDateStr || "" },
    chartData,
    professionList,
    selectedProfessions,
    shopDomain,
  };
};

// Helper ID - non utilisé pour le moment
// const extractId = (gid: string) => gid ? gid.split("/").pop() : "";

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="an-rank an-rank--1" title="1er">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56.7 56.7" fill="currentColor" width="26" height="26" aria-hidden="true">
          <path d="M28.4 8.5c-7.5 0-13.5 6.1-13.5 13.5 0 7.5 6.1 13.5 13.5 13.5S41.9 29.4 41.9 22 35.8 8.5 28.4 8.5m0 25.8c-6.8 0-12.3-5.5-12.3-12.3S21.6 9.7 28.4 9.7 40.7 15.2 40.7 22c-.1 6.9-5.6 12.3-12.3 12.3"/>
          <path d="M31.2 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h2.2v10.1h-2.2c-.4 0-.6.3-.6.6s.3.6.6.6h5.6c.4 0 .6-.3.6-.6s-.3-.6-.6-.6H29V17z"/>
          <path d="M46.3 18.7c-.7-.7-1-1.7-.8-2.7.6-2.5-.9-5.1-3.4-5.8-1-.3-1.7-1-2-2-.8-2.5-3.3-3.9-5.8-3.4-1 .2-2-.1-2.7-.7-1.9-1.8-4.8-1.8-6.7 0-.7.7-1.7.9-2.7.7-2.5-.6-5.1.9-5.8 3.4-.3.9-1 1.7-2 2-2.4.8-3.9 3.3-3.3 5.8.2 1-.1 2-.7 2.7-1.8 1.9-1.8 4.8 0 6.7.7.7.9 1.7.7 2.7-.6 2.5.9 5.1 3.4 5.8 1 .3 1.7 1 2 2 .5 1.5 1.6 2.6 3 3.1v14.1c0 .2.1.5.3.6.1.1.2.1.3.1s.2 0 .4-.1l8-5.2 8 5.2c.1.1.2.1.4.1.1 0 .2 0 .3-.1q.3-.15.3-.6v-14c1.3-.5 2.5-1.6 2.9-3.1.3-.9 1-1.7 2-2 2.5-.8 3.9-3.3 3.4-5.8-.2-1 .1-2 .7-2.7 1.5-1.9 1.5-4.9-.2-6.8M36 52l-7.2-4.7c-.1-.1-.2-.2-.4-.2h-.2c-.1 0-.3.1-.4.2L20.7 52V39.4c.5.1 1 0 1.6-.1 1-.2 2 .1 2.7.7.9.9 2.1 1.3 3.4 1.3 1.2 0 2.4-.4 3.4-1.3.7-.7 1.7-.9 2.7-.7.5.1 1.1.1 1.6.1zm9.3-27.4c-1 1-1.4 2.5-1 3.9.4 1.9-.7 3.7-2.5 4.3-1.4.4-2.4 1.5-2.8 2.8-.6 1.8-2.4 2.9-4.3 2.5-1.4-.3-2.8.1-3.9 1-1.4 1.3-3.6 1.3-5 0-.8-.7-1.8-1.1-2.9-1.1-.3 0-.6 0-1 .1-1.9.4-3.7-.7-4.3-2.5-.4-1.4-1.5-2.4-2.8-2.8-1.8-.6-2.9-2.4-2.5-4.3.3-1.4-.1-2.8-1-3.9-1.3-1.4-1.3-3.6 0-5 1-1 1.4-2.5 1-3.9-.3-1.8.7-3.7 2.6-4.3 1.4-.4 2.4-1.5 2.8-2.8.6-1.8 2.4-2.9 4.3-2.5 1.4.3 2.8-.1 3.9-1 1.4-1.3 3.6-1.3 5 0 1 1 2.5 1.4 3.9 1 1.9-.4 3.7.7 4.3 2.5.4 1.4 1.5 2.4 2.8 2.8 1.8.6 2.9 2.4 2.5 4.3-.3 1.4.1 2.8 1 3.9 1.2 1.4 1.2 3.6-.1 5"/>
        </svg>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="an-rank an-rank--2" title="2ème">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56.7 56.7" fill="currentColor" width="26" height="26" aria-hidden="true">
          <path d="M28.4 8.5c-7.5 0-13.5 6.1-13.5 13.5 0 7.5 6.1 13.5 13.5 13.5S41.9 29.4 41.9 22 35.8 8.5 28.4 8.5m0 25.8c-6.8 0-12.3-5.5-12.3-12.3S21.6 9.7 28.4 9.7 40.7 15.2 40.7 22c-.1 6.9-5.6 12.3-12.3 12.3"/>
          <path d="M28.9 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h2.2v10.1h-2.2c-.4 0-.6.3-.6.6s.3.6.6.6h5.6c.4 0 .6-.3.6-.6s-.3-.6-.6-.6h-2.2V17z"/>
          <path d="M46.3 18.7c-.7-.7-1-1.7-.8-2.7.6-2.5-.9-5.1-3.4-5.8-1-.3-1.7-1-2-2-.8-2.5-3.3-3.9-5.8-3.4-1 .2-2-.1-2.7-.7-1.9-1.8-4.8-1.8-6.7 0-.7.7-1.7.9-2.7.7-2.5-.6-5.1.9-5.8 3.4-.3.9-1 1.7-2 2-2.4.8-3.9 3.3-3.3 5.8.2 1-.1 2-.7 2.7-1.8 1.9-1.8 4.8 0 6.7.7.7.9 1.7.7 2.7-.6 2.5.9 5.1 3.4 5.8 1 .3 1.7 1 2 2 .5 1.5 1.6 2.6 3 3.1v14.1c0 .2.1.5.3.6.1.1.2.1.3.1s.2 0 .4-.1l8-5.2 8 5.2c.1.1.2.1.4.1.1 0 .2 0 .3-.1q.3-.15.3-.6v-14c1.3-.5 2.5-1.6 2.9-3.1.3-.9 1-1.7 2-2 2.5-.8 3.9-3.3 3.4-5.8-.2-1 .1-2 .7-2.7 1.5-1.9 1.5-4.9-.2-6.8M36 52l-7.2-4.7c-.1-.1-.2-.2-.4-.2h-.2c-.1 0-.3.1-.4.2L20.7 52V39.4c.5.1 1 0 1.6-.1 1-.2 2 .1 2.7.7.9.9 2.1 1.3 3.4 1.3 1.2 0 2.4-.4 3.4-1.3.7-.7 1.7-.9 2.7-.7.5.1 1.1.1 1.6.1zm9.3-27.4c-1 1-1.4 2.5-1 3.9.4 1.9-.7 3.7-2.5 4.3-1.4.4-2.4 1.5-2.8 2.8-.6 1.8-2.4 2.9-4.3 2.5-1.4-.3-2.8.1-3.9 1-1.4 1.3-3.6 1.3-5 0-.8-.7-1.8-1.1-2.9-1.1-.3 0-.6 0-1 .1-1.9.4-3.7-.7-4.3-2.5-.4-1.4-1.5-2.4-2.8-2.8-1.8-.6-2.9-2.4-2.5-4.3.3-1.4-.1-2.8-1-3.9-1.3-1.4-1.3-3.6 0-5 1-1 1.4-2.5 1-3.9-.3-1.8.7-3.7 2.6-4.3 1.4-.4 2.4-1.5 2.8-2.8.6-1.8 2.4-2.9 4.3-2.5 1.4.3 2.8-.1 3.9-1 1.4-1.3 3.6-1.3 5 0 1 1 2.5 1.4 3.9 1 1.9-.4 3.7.7 4.3 2.5.4 1.4 1.5 2.4 2.8 2.8 1.8.6 2.9 2.4 2.5 4.3-.3 1.4.1 2.8 1 3.9 1.2 1.4 1.2 3.6-.1 5"/>
          <path d="M33.5 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h2.2v10.1h-2.2c-.4 0-.6.3-.6.6s.3.6.6.6h5.6c.4 0 .6-.3.6-.6s-.3-.6-.6-.6h-2.2V17z"/>
        </svg>
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="an-rank an-rank--3" title="3ème">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56.7 56.7" fill="currentColor" width="26" height="26" aria-hidden="true">
          <path d="M28.4 8.5c-7.5 0-13.5 6.1-13.5 13.5 0 7.5 6.1 13.5 13.5 13.5S41.9 29.4 41.9 22 35.8 8.5 28.4 8.5m0 25.8c-6.8 0-12.3-5.5-12.3-12.3S21.6 9.7 28.4 9.7 40.7 15.2 40.7 22c-.1 6.9-5.6 12.3-12.3 12.3"/>
          <path d="M31.2 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h2.2v10.1h-2.2c-.4 0-.6.3-.6.6s.3.6.6.6h5.6c.4 0 .6-.3.6-.6s-.3-.6-.6-.6H29V17z"/>
          <path d="M46.3 18.7c-.7-.7-1-1.7-.8-2.7.6-2.5-.9-5.1-3.4-5.8-1-.3-1.7-1-2-2-.8-2.5-3.3-3.9-5.8-3.4-1 .2-2-.1-2.7-.7-1.9-1.8-4.8-1.8-6.7 0-.7.7-1.7.9-2.7.7-2.5-.6-5.1.9-5.8 3.4-.3.9-1 1.7-2 2-2.4.8-3.9 3.3-3.3 5.8.2 1-.1 2-.7 2.7-1.8 1.9-1.8 4.8 0 6.7.7.7.9 1.7.7 2.7-.6 2.5.9 5.1 3.4 5.8 1 .3 1.7 1 2 2 .5 1.5 1.6 2.6 3 3.1v14.1c0 .2.1.5.3.6.1.1.2.1.3.1s.2 0 .4-.1l8-5.2 8 5.2c.1.1.2.1.4.1.1 0 .2 0 .3-.1q.3-.15.3-.6v-14c1.3-.5 2.5-1.6 2.9-3.1.3-.9 1-1.7 2-2 2.5-.8 3.9-3.3 3.4-5.8-.2-1 .1-2 .7-2.7 1.5-1.9 1.5-4.9-.2-6.8M36 52l-7.2-4.7c-.1-.1-.2-.2-.4-.2h-.2c-.1 0-.3.1-.4.2L20.7 52V39.4c.5.1 1 0 1.6-.1 1-.2 2 .1 2.7.7.9.9 2.1 1.3 3.4 1.3 1.2 0 2.4-.4 3.4-1.3.7-.7 1.7-.9 2.7-.7.5.1 1.1.1 1.6.1zm9.3-27.4c-1 1-1.4 2.5-1 3.9.4 1.9-.7 3.7-2.5 4.3-1.4.4-2.4 1.5-2.8 2.8-.6 1.8-2.4 2.9-4.3 2.5-1.4-.3-2.8.1-3.9 1-1.4 1.3-3.6 1.3-5 0-.8-.7-1.8-1.1-2.9-1.1-.3 0-.6 0-1 .1-1.9.4-3.7-.7-4.3-2.5-.4-1.4-1.5-2.4-2.8-2.8-1.8-.6-2.9-2.4-2.5-4.3.3-1.4-.1-2.8-1-3.9-1.3-1.4-1.3-3.6 0-5 1-1 1.4-2.5 1-3.9-.3-1.8.7-3.7 2.6-4.3 1.4-.4 2.4-1.5 2.8-2.8.6-1.8 2.4-2.9 4.3-2.5 1.4.3 2.8-.1 3.9-1 1.4-1.3 3.6-1.3 5 0 1 1 2.5 1.4 3.9 1 1.9-.4 3.7.7 4.3 2.5.4 1.4 1.5 2.4 2.8 2.8 1.8.6 2.9 2.4 2.5 4.3-.3 1.4.1 2.8 1 3.9 1.2 1.4 1.2 3.6-.1 5"/>
          <path d="M27 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h2.2v10.1h-2.2c-.4 0-.6.3-.6.6 0 .4.3.6.6.6H27c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-2.2V17z"/>
          <path d="M35.4 17c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-5.6c-.4 0-.6.3-.6.6 0 .4.3.6.6.6H32v10.1h-2.2c-.4 0-.6.3-.6.6 0 .4.3.6.6.6h5.6c.4 0 .6-.3.6-.6 0-.4-.3-.6-.6-.6h-2.2V17z"/>
        </svg>
      </span>
    );
  }
  return <span className="an-rank">{rank}</span>;
}

export default function AnalytiquePage() {
  const { stats, ranking, isInitialized, filters, chartData, professionList, selectedProfessions: initialSelectedProfessions, shopDomain } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState(filters.startDate);
  const [endDate, setEndDate] = useState(filters.endDate);
  const [searchShortcut, setSearchShortcut] = useState("Ctrl ⇧ K");
  const [selectedProfs, setSelectedProfs] = useState<string[]>(initialSelectedProfessions ?? []);
  const [showProfDropdown, setShowProfDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const profDropdownRef = useRef<HTMLDivElement>(null);

  function handleBarClick(key: string) {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const sd = `${y}-${String(m).padStart(2, "0")}-01`;
    const ed = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    const params = new URLSearchParams();
    params.set("startDate", sd);
    params.set("endDate", ed);
    selectedProfs.forEach(p => params.append("profession", p));
    navigate(`/app/analytique?${params.toString()}`);
  }

  useEffect(() => { setCurrentPage(1); }, [searchQuery]);
  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
    setSearchShortcut(isMac ? "⌘ ⇧ K" : "Ctrl ⇧ K");
  }, []);
  useEffect(() => {
    setStartDate(filters.startDate);
    setEndDate(filters.endDate);
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    setSelectedProfs(initialSelectedProfessions ?? []);
  }, [initialSelectedProfessions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profDropdownRef.current && !profDropdownRef.current.contains(e.target as Node)) {
        setShowProfDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isInitialized) {
    return (
      <div className="an-page an-not-init">
        <div className="an-not-init__card">
          <h2 className="an-not-init__title">Application non initialisée</h2>
          <p className="an-not-init__text">Veuillez vous rendre sur la page principale pour configurer l&apos;application.</p>
          <Link to="/app" className="an-not-init__link">
            Aller sur la page principale
          </Link>
        </div>
      </div>
    );
  }

  const now = new Date();
  const yr = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(yr, now.getMonth() + 1, 0).getDate();
  const currentMonthStart = `${yr}-${mo}-01`;
  const currentMonthEnd = `${yr}-${mo}-${String(lastDay).padStart(2, "0")}`;
  const itemsPerPage = 25;
  const filteredRanking = searchQuery
    ? ranking.filter((pro) =>
        pro.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pro.profession.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pro.code.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : ranking;
  const totalPages = Math.ceil(filteredRanking.length / itemsPerPage);
  const currentRanking = filteredRanking.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );
  const prosProgress = stats?.totalPros
    ? Math.round(((stats.activePros ?? 0) / stats.totalPros) * 100)
    : 0;

  const activeMonths = chartData.filter(d => !d.ghost);
  const periodLabel = stats?.isDateFiltered
    ? activeMonths.length > 1
      ? `${activeMonths[0].month} – ${activeMonths[activeMonths.length - 1].month}`
      : activeMonths.length === 1
        ? activeMonths[0].month
        : "Commandes sur la période"
    : "Nombre de commandes par affiliation";

  const moisParams = new URLSearchParams();
  moisParams.set("startDate", currentMonthStart);
  moisParams.set("endDate", currentMonthEnd);
  selectedProfs.forEach(p => moisParams.append("profession", p));
  const moisLink = `/app/analytique?${moisParams.toString()}`;

  return (
    <div className="an-page">

      {/* === TITRE === */}
      <div className="page-header">
        <h1 className="page-header__title">Analytique</h1>
      </div>

      {/* === CARTES STATS === */}
      <div className="an-stats-row">

        {/* Commandes */}
        <div className="an-card">
          <p className="an-card-label">{periodLabel}</p>
          <div className="an-card-content an-card-content-chart">
            <div className="an-card-value">{stats?.totalOrders ?? 0}</div>
            {stats?.isDateFiltered && !stats?.isFullMonthFilter ? (
              (() => {
                const h = (stats?.totalOrders ?? 0) === 0 ? 7 : 50;
                return (
                  <div className="an-chart an-chart--single">
                    <div className="an-chart-col an-chart-col--single">
                      <div className="an-chart-bar-wrap">
                        <div className="an-chart-bar" style={{ height: `${h}px` }} />
                      </div>
                      <span className="an-chart-label">{periodLabel}</span>
                    </div>
                  </div>
                );
              })()
            ) : (
              chartData.length > 0 && (() => {
                const maxVal = Math.max(...chartData.map((d) => d.count), 1);
                return (
                  <div className="an-chart">
                    {chartData.map((d) => {
                      const h = d.count === 0 ? 7 : Math.max(7, Math.round((d.count / maxVal) * 50));
                      return (
                        <div key={d.key} className={`an-chart-col${d.ghost ? " an-chart-col--ghost" : ""}`} onClick={() => handleBarClick(d.key)} title={d.month}>
                          <span className="an-chart-count">{d.count}</span>
                          <div className="an-chart-bar-wrap">
                            <div className="an-chart-bar" style={{ height: `${h}px` }} />
                          </div>
                          <span className="an-chart-label">{d.month}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {/* Pros actifs */}
        <div className="an-card">
          <div className="an-card-top">
            <p className="an-card-label">Professionnels de santé</p>
            <span className="an-card-badge">{stats?.totalPros ?? 0} enregistrés</span>
          </div>
          <div className="an-card-content">
            <div className="an-card-value">
                {stats?.activePros ?? 0} Actifs
            </div>
            <div className="an-progress-track">
                <div className="an-progress-fill" style={{ width: `${prosProgress}%` }} />
            </div>
          </div>
        </div>

        {/* CA généré */}
        <div className="an-card">
          <div className="an-card-top">
            <p className="an-card-label">CA généré</p>
            <div className="an-toggle">
              <Link
                to="/app/analytique"
                className={`an-toggle-btn${!stats?.isDateFiltered ? " an-toggle-btn--on" : ""}`}
              >
                Total
              </Link>
              <Link
                to={moisLink}
                className={`an-toggle-btn${stats?.isDateFiltered ? " an-toggle-btn--on" : ""}`}
              >
                Mois
              </Link>
            </div>
          </div>
          <div className="an-card-value">
            {(stats?.totalRevenue ?? 0).toFixed(2)} €
          </div>
        </div>

      </div>

      {/* === TOOLBAR === */}
      <div className="toolbar">
        <Form method="get" className="an-filters-form">
          {selectedProfs.map(p => <input key={p} type="hidden" name="profession" value={p} />)}
          <button type="submit" className="an-filter-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-no-shrink">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
              <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
            </svg>
            Filtres
          </button>
          <span className="an-filter-lbl">du</span>
          <div className="an-filter-date-wrap" data-empty={!startDate ? "true" : "false"} data-ph="---- / ---- / ----">
            <input
              type="date"
              name="startDate"
              value={startDate}
              className="an-filter-date"
              onChange={(e) => {
                const val = e.target.value;
                setStartDate(val);
                const p = new URLSearchParams();
                if (val) p.set("startDate", val);
                if (endDate) p.set("endDate", endDate);
                selectedProfs.forEach(s => p.append("profession", s));
                navigate(`/app/analytique?${p.toString()}`);
              }}
            />
          </div>
          <span className="an-filter-lbl">au</span>
          <div className="an-filter-date-wrap" data-empty={!endDate ? "true" : "false"} data-ph="---- / ---- / ----">
            <input
              type="date"
              name="endDate"
              value={endDate}
              className="an-filter-date"
              onChange={(e) => {
                const val = e.target.value;
                setEndDate(val);
                const p = new URLSearchParams();
                if (startDate) p.set("startDate", startDate);
                if (val) p.set("endDate", val);
                selectedProfs.forEach(s => p.append("profession", s));
                navigate(`/app/analytique?${p.toString()}`);
              }}
            />
          </div>
          {professionList.length > 0 && (
            <div className="an-prof-dropdown" ref={profDropdownRef}>
              <button
                type="button"
                className={`an-prof-btn${selectedProfs.length > 0 ? " an-prof-btn--active" : ""}`}
                onClick={() => setShowProfDropdown(v => !v)}
              >
                Profession{selectedProfs.length > 0 ? ` (${selectedProfs.length})` : ""}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 3.5l3 3 3-3" />
                </svg>
              </button>
              {showProfDropdown && (
                <div className="an-prof-dropdown-menu">
                  {professionList.map(prof => (
                    <label key={prof} className="an-prof-option">
                      <input
                        type="checkbox"
                        checked={selectedProfs.includes(prof)}
                        onChange={(e) => {
                          const newProfs = e.target.checked
                            ? [...selectedProfs, prof]
                            : selectedProfs.filter(p => p !== prof);
                          setSelectedProfs(newProfs);
                          const params = new URLSearchParams();
                          if (startDate) params.set("startDate", startDate);
                          if (endDate) params.set("endDate", endDate);
                          newProfs.forEach(p => params.append("profession", p));
                          navigate(`/app/analytique?${params.toString()}`);
                        }}
                      />
                      <span>{prof}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {stats?.isFiltered && (
            <Link to="/app/analytique" className="an-filter-reset">Réinitialiser</Link>
          )}
        </Form>
        <div className="grow" />
        <div className="search-container">
          <div className="basilic-search">
            <div className="basilic-search__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              type="text"
              className="basilic-search__input"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="basilic-search__shortcut">
              <span className="basilic-search__shortcut-key">{searchShortcut}</span>
            </div>
          </div>
        </div>
      </div>

      {/* === TABLE === */}
      <div className="table-card">
        <div className="table-card__header">
          <span className="table-card__title">Classement par chiffre d&apos;affaires</span>
        </div>

        <div className="table-scroll">
          <table className="ui-table an-ranking-table">
            <thead className="ui-table__thead">
              <tr className="ui-table__header-row">
                <th className="ui-table__th ui-table__th--center ui-table__th--base an-th--rang">Rang</th>
                <th className="ui-table__th ui-table__th--base">Prénom Nom</th>
                <th className="ui-table__th ui-table__th--base">Profession</th>
                <th className="ui-table__th ui-table__th--center ui-table__th--base an-th--rang">Lien</th>
                <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center an-th--col-sm">Code Promo</th>
                <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center an-th--col-sm">Valeur</th>
                <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center an-th--col-sm">Commandes</th>
                <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center an-th--col-sm">CA Généré</th>
              </tr>
            </thead>
            <tbody className="ui-table__tbody">
              {currentRanking.length === 0 ? (
                <tr>
                  <td colSpan={8} className="ui-table__td ui-table__td--empty">
                    {searchQuery ? "Aucun résultat pour cette recherche." : "Aucun pro enregistré."}
                  </td>
                </tr>
              ) : (
                currentRanking.map((pro, index: number) => {
                  const rank = (currentPage - 1) * itemsPerPage + index + 1;
                  return (
                    <tr key={pro.id} className="ui-table__row">
                      <td className="ui-table__td ui-table__td--center">
                        <RankBadge rank={rank} />
                      </td>
                      <td className="ui-table__td ui-table__td--bold">
                        <span className="mf-text--title">{pro.name}</span>
                      </td>
                      <td className="ui-table__td ui-table__td--muted">
                        <span className="mf-text--title">{pro.profession}</span>
                      </td>
                      <td className="ui-table__td ui-table__td--center">
                        {pro.customerId
                          ? <a href={`https://${shopDomain}/admin/customers/${pro.customerId.split("/").pop()}`} target="_blank" rel="noopener noreferrer" title="Voir la fiche client" className="customer-link">
                              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                <path d="M8.372 11.6667C7.11703 10.4068 7.23007 8.25073 8.62449 6.8509L12.6642 2.79552C14.0586 1.39569 16.2064 1.28221 17.4613 2.54205C18.7163 3.8019 18.6033 5.95797 17.2088 7.35779L15.189 9.3855" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                <path opacity="0.5" d="M11.6278 8.33334C12.8828 9.59318 12.7698 11.7492 11.3753 13.1491L9.3555 15.1768L7.33566 17.2045C5.94124 18.6043 3.79348 18.7178 2.53851 17.4579C1.28353 16.1981 1.39658 14.042 2.79099 12.6422L4.81086 10.6145" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </a>
                          : <span className="ui-table__td--muted">—</span>
                        }
                      </td>
                      <td className="ui-table__td ui-table__td--center mf-cell--devmode--green">
                        <span className="an-code">{pro.code}</span>
                      </td>
                      <td className="ui-table__td ui-table__td--center mf-cell--devmode--green an-td--green-val">{pro.value}</td>
                      <td className="ui-table__td ui-table__td--center mf-cell--devmode--blue an-td--blue-val">{pro.ordersCount}</td>
                      <td className="ui-table__td ui-table__td--center mf-cell--devmode--blue an-td--blue-total">{pro.revenue.toFixed(2)} €</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredRanking.length > itemsPerPage && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  );
}
