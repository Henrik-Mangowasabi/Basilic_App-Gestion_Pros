import { describe, it, expect } from "vitest";
import { computeCreditsForOrder } from "./credits";

// Config par défaut de l'app : 1 crédit de 10€ tous les 500€ de CA
const BASE = {
  limitationUnlockDate: "",
  threshold: 500,
  creditAmount: 10,
  now: new Date("2026-07-16T12:00:00Z"),
};

describe("computeCreditsForOrder — illimite", () => {
  it("n'émet aucun crédit si le palier n'est pas atteint", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "illimite", currentRemainder: 100, orderAmount: 200 });
    expect(r.creditsToAdd).toBe(0);
    expect(r.remainderIfDeposited).toBe(300);
    expect(r.remainderIfNotDeposited).toBe(300);
    expect(r.newLimitationDate).toBeNull();
  });

  it("émet 1 crédit quand un palier est franchi", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "illimite", currentRemainder: 450, orderAmount: 100 });
    expect(r.creditsToAdd).toBe(10);
    expect(r.remainderIfDeposited).toBe(50);
    expect(r.remainderIfNotDeposited).toBe(550); // si le virement échoue, rien n'avance
  });

  it("émet N crédits quand plusieurs paliers sont franchis par une seule commande", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "illimite", currentRemainder: 0, orderAmount: 1250 });
    expect(r.creditsToAdd).toBe(20); // 2 paliers de 500€
    expect(r.remainderIfDeposited).toBe(250);
  });

  it("gère le palier exact (remainder retombe à 0)", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "illimite", currentRemainder: 0, orderAmount: 500 });
    expect(r.creditsToAdd).toBe(10);
    expect(r.remainderIfDeposited).toBe(0);
  });
});

describe("computeCreditsForOrder — sans_remuneration", () => {
  it("n'émet jamais de crédit mais accumule le CA", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "sans_remuneration", currentRemainder: 400, orderAmount: 700 });
    expect(r.creditsToAdd).toBe(0);
    expect(r.remainderIfNotDeposited).toBe(1100);
    expect(r.newLimitationDate).toBeNull();
  });
});

describe("computeCreditsForOrder — limite_annee", () => {
  it("bloqué (date de déblocage future) : aucun crédit, accumulation du CA", () => {
    const r = computeCreditsForOrder({
      ...BASE,
      remunerationType: "limite_annee",
      limitationUnlockDate: "2027-01-01", // futur par rapport à now
      currentRemainder: 900,
      orderAmount: 300,
    });
    expect(r.creditsToAdd).toBe(0);
    expect(r.remainderIfNotDeposited).toBe(1200); // grossit sans limite pendant le blocage
    expect(r.newLimitationDate).toBeNull();
  });

  it("non bloqué : 1 seul crédit max même si plusieurs paliers sont franchis, et pose les dates de blocage (+1 an)", () => {
    const r = computeCreditsForOrder({
      ...BASE,
      remunerationType: "limite_annee",
      currentRemainder: 0,
      orderAmount: 1600, // 3 paliers théoriques
    });
    expect(r.creditsToAdd).toBe(10); // 1 seul crédit
    expect(r.remainderIfDeposited).toBe(1100); // une seule soustraction de 500
    expect(r.newLimitationDate).toBe("2026-07-16");
    expect(r.newLimitationUnlockDate).toBe("2027-07-16");
  });

  it("non bloqué sans franchissement : aucun crédit, aucune date posée", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "limite_annee", currentRemainder: 100, orderAmount: 200 });
    expect(r.creditsToAdd).toBe(0);
    expect(r.newLimitationDate).toBeNull();
  });

  it("date de déblocage passée : le pro est débloqué et peut regagner 1 crédit", () => {
    const r = computeCreditsForOrder({
      ...BASE,
      remunerationType: "limite_annee",
      limitationUnlockDate: "2026-01-01", // passé par rapport à now
      currentRemainder: 490,
      orderAmount: 20,
    });
    expect(r.creditsToAdd).toBe(10);
    expect(r.remainderIfDeposited).toBe(10);
    expect(r.newLimitationUnlockDate).toBe("2027-07-16");
  });
});

describe("computeCreditsForOrder — robustesse", () => {
  it("type inconnu → traité comme illimite (comportement historique)", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "", currentRemainder: 0, orderAmount: 600 });
    expect(r.creditsToAdd).toBe(10);
  });

  it("commande à 0€ : rien ne bouge", () => {
    const r = computeCreditsForOrder({ ...BASE, remunerationType: "illimite", currentRemainder: 250, orderAmount: 0 });
    expect(r.creditsToAdd).toBe(0);
    expect(r.remainderIfNotDeposited).toBe(250);
  });
});
