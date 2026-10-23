import {
  getCompanyFundamentals,
  getCompanyProfile,
  getRiskFreeRate,
  type CompanyFundamentals,
  type CompanyProfile,
  type FmpFailureReason,
} from "@/lib/fmp";
import { classifyStock, type Classification } from "@/lib/valuation/classify";
import { buildDefaults, type DefaultAssumptions } from "@/lib/valuation/defaults";

export type ProjectionData = {
  fundamentals: CompanyFundamentals;
  profile: CompanyProfile | null;
  profileFailure: FmpFailureReason | null;
  riskFreeRate: number | null;
  classification: Classification;
  defaults: DefaultAssumptions;
};

export type ProjectionDataResult =
  | { ok: true; data: ProjectionData }
  | { ok: false; reason: FmpFailureReason };

// FMP responses are cached, so the page and the AI autofill share one set of requests.
export async function loadProjectionData(symbol: string): Promise<ProjectionDataResult> {
  const [fundamentals, profileResult, riskFreeRate] = await Promise.all([
    getCompanyFundamentals(symbol),
    getCompanyProfile(symbol),
    getRiskFreeRate(),
  ]);
  if (!fundamentals.ok) return fundamentals;

  const profile = profileResult.ok ? profileResult.data : null;
  const classification = classifyStock(fundamentals.data.annualFinancials, profile);
  const defaults = buildDefaults({
    financials: fundamentals.data.annualFinancials,
    profile,
    riskFreeRate,
    type: classification.type,
  });

  return {
    ok: true,
    data: {
      fundamentals: fundamentals.data,
      profile,
      profileFailure: profileResult.ok ? null : profileResult.reason,
      riskFreeRate,
      classification,
      defaults,
    },
  };
}
