// Logique PURE de calcul des crédits par paliers — aucun appel Shopify.
// Extraite du webhook orders/create pour être testable unitairement (voir credits.test.ts).

export type CreditComputation = {
  /** Montant de crédit à déposer (0 si aucun palier franchi ou pro bloqué) */
  creditsToAdd: number;
  /** Valeur de cache_ca_remainder SI le virement réussit (paliers soustraits) */
  remainderIfDeposited: number;
  /** Valeur de cache_ca_remainder si aucun virement n'a lieu (simple accumulation) */
  remainderIfNotDeposited: number;
  /** Dates de blocage à poser si le crédit limite_annee est versé (YYYY-MM-DD), sinon null */
  newLimitationDate: string | null;
  newLimitationUnlockDate: string | null;
};

export function computeCreditsForOrder(params: {
  remunerationType: string; // "illimite" | "limite_annee" | "sans_remuneration"
  limitationUnlockDate: string; // "" si aucune
  currentRemainder: number;
  orderAmount: number;
  threshold: number;
  creditAmount: number;
  now?: Date; // injectable pour les tests
}): CreditComputation {
  const {
    remunerationType,
    limitationUnlockDate,
    currentRemainder,
    orderAmount,
    threshold,
    creditAmount,
  } = params;
  const now = params.now ?? new Date();

  const accumulated = currentRemainder + orderAmount;
  let potentialRemainder = accumulated;
  let creditsToAdd = 0;
  let newLimitationDate: string | null = null;
  let newLimitationUnlockDate: string | null = null;

  if (remunerationType === "sans_remuneration") {
    // Jamais de crédit — on accumule uniquement le CA pour les stats
    creditsToAdd = 0;
  } else if (remunerationType === "limite_annee") {
    const isBlocked = !!limitationUnlockDate && new Date(limitationUnlockDate) > now;
    if (!isBlocked && potentialRemainder >= threshold) {
      // Non bloqué : 1 seul crédit max si le palier est franchi
      creditsToAdd = creditAmount;
      potentialRemainder -= threshold; // soustraction unique
      // Dates de blocage (appliquées uniquement si le virement réussit)
      const unlock = new Date(now);
      unlock.setFullYear(unlock.getFullYear() + 1);
      newLimitationDate = now.toISOString().split("T")[0];
      newLimitationUnlockDate = unlock.toISOString().split("T")[0];
    }
    // Bloqué : on accumule le CA mais aucun crédit
  } else {
    // illimite : N crédits possibles
    while (potentialRemainder >= threshold) {
      creditsToAdd += creditAmount;
      potentialRemainder -= threshold;
    }
  }

  return {
    creditsToAdd,
    remainderIfDeposited: potentialRemainder,
    remainderIfNotDeposited: accumulated,
    newLimitationDate,
    newLimitationUnlockDate,
  };
}
