import exec from "k6/execution";
import { Counter, Rate } from "k6/metrics";
import {
  charge,
  errorCode,
  lookup,
  loadFixtures,
  paymentCodeOf,
  pick,
  studentNumberOf,
  topup,
} from "./lib.js";
import { DEFAULT_PROFILE, describeProfile, profileViolations } from "./profile.js";

const DURATION = __ENV.DURATION || "10m";
const CHARGE_RATE = Number(__ENV.CHARGE_RATE || DEFAULT_PROFILE.chargesPerSecond);
const LOOKUPS_PER_CHARGE = Number(__ENV.LOOKUPS_PER_CHARGE || DEFAULT_PROFILE.lookupsPerCharge);
const LOOKUP_RATE = Number(__ENV.LOOKUP_RATE || CHARGE_RATE * LOOKUPS_PER_CHARGE);
const TOPUP_RATE_PER_MIN = Number(__ENV.TOPUP_RATE_PER_MIN || DEFAULT_PROFILE.topupsPerMinute);
const TOPUP_AMOUNT_CENTS = Number(__ENV.TOPUP_AMOUNT_CENTS || 500);

const EXPECT_RATE_LIMIT = __ENV.EXPECT_RATE_LIMIT === "1" || __ENV.EXPECT_RATE_LIMIT === "true";

const fixtures = loadFixtures();
const sellers = __ENV.SELLER_POOL
  ? fixtures.charge.sellers.slice(0, Number(__ENV.SELLER_POOL))
  : fixtures.charge.sellers;

const effectiveProfile = {
  chargesPerSecond: CHARGE_RATE,
  lookupsPerCharge: LOOKUP_RATE / CHARGE_RATE,
  topupsPerMinute: TOPUP_RATE_PER_MIN,
  sellerPool: sellers.length,
  sacPool: fixtures.topup.sacMembers.length,
};

const unexpectedErrors = new Rate("unexpected_errors");
const insufficientFunds = new Counter("insufficient_funds");
const rateLimited = new Counter("rate_limited");

export const options = {
  discardResponseBodies: false,
  scenarios: {
    charges: {
      executor: "constant-arrival-rate",
      exec: "chargeIter",
      rate: CHARGE_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    lookups: {
      executor: "constant-arrival-rate",
      exec: "lookupIter",
      rate: LOOKUP_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    topups: {
      executor: "constant-arrival-rate",
      exec: "topupIter",
      rate: TOPUP_RATE_PER_MIN,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    "http_req_duration{expected_response:true}": ["p(95)<500"],
    unexpected_errors: ["rate<0.01"],
  },
};

export function setup() {
  const problems = profileViolations(effectiveProfile);
  console.log(
    `lunch-rush profile: ${CHARGE_RATE} charges/s + ${LOOKUP_RATE} lookups/s ` +
      `(${effectiveProfile.lookupsPerCharge.toFixed(1)}x) + ${TOPUP_RATE_PER_MIN} top-ups/min ` +
      `across ${sellers.length} sellers / ${effectiveProfile.sacPool} SAC members\n` +
      describeProfile(effectiveProfile),
  );
  if (problems.length === 0) return null;
  if (EXPECT_RATE_LIMIT) {
    console.warn(
      `EXPECT_RATE_LIMIT set — running a deliberate limiter probe:\n  ${problems.join("\n  ")}`,
    );
    return null;
  }
  throw new Error(
    `This profile does not model a lunch rush:\n  ${problems.join("\n  ")}\n` +
      `Set EXPECT_RATE_LIMIT=1 if you meant to probe the rate limiter.`,
  );
}

function classify(res) {
  const code = errorCode(res);
  if (code === "INSUFFICIENT_FUNDS") {
    insufficientFunds.add(1);
    unexpectedErrors.add(0);
    return;
  }
  if (code === "RATE_LIMITED") {
    rateLimited.add(1);
    unexpectedErrors.add(!EXPECT_RATE_LIMIT);
    return;
  }
  unexpectedErrors.add(res.status < 200 || res.status >= 300);
}

export function chargeIter() {
  const i = exec.scenario.iterationInTest;
  const seller = pick(sellers, i);
  const buyer = pick(fixtures.charge.buyers, i);
  classify(charge(seller, paymentCodeOf(buyer)));
}

export function lookupIter() {
  const i = exec.scenario.iterationInTest;
  const seller = pick(sellers, i * 7 + 1);
  const buyer = pick(fixtures.charge.buyers, i * 3 + 2);
  classify(lookup(seller, paymentCodeOf(buyer)));
}

export function topupIter() {
  const i = exec.scenario.iterationInTest;
  const sac = pick(fixtures.topup.sacMembers, i);
  const buyer = pick(fixtures.topup.buyers, i);
  classify(topup(sac, studentNumberOf(buyer), TOPUP_AMOUNT_CENTS));
}
