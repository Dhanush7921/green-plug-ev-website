// All money is integer paise. Rates are basis points (1500 = 15.00 %).
export type Quote = {
  ratePaise: number;
  plannedKwh: number;
  basePaise: number;
  feeBps: number;
  commissionBps: number;
  customerFeePaise: number;
  customerTotalPaise: number;
  providerCommissionPaise: number;
  partnerAmountPaise: number;
  platformRevenuePaise: number;
};

export function computeQuote(ratePaise: number, plannedKwh: number, feeBps: number, commissionBps: number): Quote {
  const basePaise = Math.round(ratePaise * plannedKwh);
  const customerFeePaise = Math.round((basePaise * feeBps) / 10000);
  const providerCommissionPaise = Math.round((basePaise * commissionBps) / 10000);
  return {
    ratePaise,
    plannedKwh,
    basePaise,
    feeBps,
    commissionBps,
    customerFeePaise,
    customerTotalPaise: basePaise + customerFeePaise,
    providerCommissionPaise,
    partnerAmountPaise: basePaise - providerCommissionPaise,
    platformRevenuePaise: customerFeePaise + providerCommissionPaise,
  };
}

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
