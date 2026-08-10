export const SCOPES = ["charge", "lookup", "topup"];

export const ASSUMED_LIMITS = {
  charge: { limit: 120, windowMs: 60000 },
  lookup: { limit: 120, windowMs: 60000 },
  topup: { limit: 40, windowMs: 60000 },
};

export const DEFAULT_PROFILE = {
  chargesPerSecond: 10,
  lookupsPerCharge: 3,
  topupsPerMinute: 30,
  sellerPool: 80,
  sacPool: 4,
};

export const MAX_CAP_UTILISATION = 0.5;

export function perUidPerMinute(profile) {
  const chargesPerMinute = profile.chargesPerSecond * 60;
  return {
    charge: chargesPerMinute / profile.sellerPool,
    lookup: (chargesPerMinute * profile.lookupsPerCharge) / profile.sellerPool,
    topup: profile.topupsPerMinute / profile.sacPool,
  };
}

function capPerMinute(scope) {
  const rule = ASSUMED_LIMITS[scope];
  return rule.limit * (60000 / rule.windowMs);
}

export function capUtilisation(profile) {
  const demand = perUidPerMinute(profile);
  return {
    charge: demand.charge / capPerMinute("charge"),
    lookup: demand.lookup / capPerMinute("lookup"),
    topup: demand.topup / capPerMinute("topup"),
  };
}

export function profileViolations(profile) {
  const problems = [];

  if (profile.lookupsPerCharge < 1) {
    problems.push(
      `lookupsPerCharge is ${profile.lookupsPerCharge}: the POS cannot ring a charge until a lookup has resolved, so lookups can never trail charges`,
    );
  }

  const utilisation = capUtilisation(profile);
  const demand = perUidPerMinute(profile);
  for (const scope of SCOPES) {
    if (utilisation[scope] > MAX_CAP_UTILISATION) {
      problems.push(
        `${scope} demand is ${demand[scope].toFixed(1)}/min per uid, ` +
          `${(utilisation[scope] * 100).toFixed(0)}% of its ${ASSUMED_LIMITS[scope].limit}/min cap: ` +
          `this run measures the rate limiter, not the app (PRD NFR-8 requires a lunch-rush operator never meet a 429)`,
      );
    }
  }

  return problems;
}

export function describeProfile(profile) {
  const demand = perUidPerMinute(profile);
  const utilisation = capUtilisation(profile);
  return SCOPES.map(
    (scope) =>
      `  ${scope.padEnd(7)} ${demand[scope].toFixed(1).padStart(6)}/min per uid  ` +
      `(${(utilisation[scope] * 100).toFixed(1)}% of ${ASSUMED_LIMITS[scope].limit}/min)`,
  ).join("\n");
}
