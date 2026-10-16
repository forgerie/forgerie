import { Ledger } from "./Ledger";

export const name = "Ledger";
export const note = "Amounts of money in one aligned column, with totals and signed negatives";

export default function Shortfall() {
  return <Ledger code={"Earmarked against checking\nFrance flights: $4,500.00\nFrance lodging: $1,692.87\nOrthodontics: $1,500.00\nHoliday trip to Texas: $500.00\nEmergency fund top-up: $18,883.94\n= Total earmarked: $27,076.81\nChecking balance: $18,558.34\n= Shortfall: -$8,518.47"} />;
}
export function EdgeCases() {
  return <Ledger code={"House sale, closing statement\nSale price: $1,284,950.00\nMortgage payoff: -$612,408.19\nUtility true-up: $131.30 to -$68.70\nCounty transfer tax: ?\nEscrow refund ref ESCROW-REFUND-20261003-0000-8841-AXZ-PACE-SAVINGS-SWEEP: $2,114.06\n= Net to seller: $674,655.87"} />;
}
export function Arriving() {
  return <Ledger code={"Earmarked against checking\nFrance flights: $4,500.00\n= Total earmarked:"} />;
}
