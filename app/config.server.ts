// Configuration de l'app — plus de base de données, tout vient des env vars
export const appConfig = {
  threshold: parseFloat(process.env.CREDIT_THRESHOLD || "500"),
  creditAmount: parseFloat(process.env.CREDIT_AMOUNT || "10"),
};
