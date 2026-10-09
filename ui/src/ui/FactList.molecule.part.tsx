import { FactList } from "./FactList";

export const name = "Fact list";
export const note = "Headline values from Label: value lines";

export default function Report() {
  return <FactList code={"Tests: 1017 passed\nBundle: +4.2 kB gzip\nPostures: 4 of 4\nDeploy: pending"} />;
}
export function Two() {
  return <FactList code={"Time: 3 min\nCost: $0.42"} />;
}
export function LongValues() {
  return <FactList code={"Slowest test: `globalProviderPolicy.acceptance.test.ts`\nRoot cause: timeout under full-suite load\nRetries: 0"} />;
}
