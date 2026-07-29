import { check } from "k6";
import exec from "k6/execution";
import { Counter, Rate } from "k6/metrics";
import { charge, errorCode, loadFixtures, paymentCodeOf, pick } from "./lib.js";

const CONTENTION_ITERS = Number(__ENV.CONTENTION_ITERS || 400);
const IDEMPOTENCY_ITERS = Number(__ENV.IDEMPOTENCY_ITERS || 360);
const DUPLICATES_PER_KEY = Number(__ENV.DUPLICATES_PER_KEY || 6);
const CONTENTION_VUS = Number(__ENV.CONTENTION_VUS || 20);
const IDEMPOTENCY_VUS = Number(__ENV.IDEMPOTENCY_VUS || 12);

const ACCEPT_ABORTS = __ENV.ACCEPT_ABORTS === "1" || __ENV.ACCEPT_ABORTS === "true";

const fixtures = loadFixtures();

const unexpectedErrors = new Rate("unexpected_errors");
const chargeAccepted = new Counter("charge_accepted");
const chargeRejectedFunds = new Counter("charge_rejected_insufficient");
const chargeRateLimited = new Counter("charge_rate_limited");
const contentionAborted = new Counter("contention_aborted");

export const options = {
  discardResponseBodies: false,
  scenarios: {
    contention: {
      executor: "shared-iterations",
      exec: "contentionIter",
      vus: CONTENTION_VUS,
      iterations: CONTENTION_ITERS,
      maxDuration: "5m",
    },
    idempotency: {
      executor: "shared-iterations",
      exec: "idempotencyIter",
      vus: IDEMPOTENCY_VUS,
      iterations: IDEMPOTENCY_ITERS,
      maxDuration: "5m",
      startTime: "0s",
    },
  },
  thresholds: {
    unexpected_errors: ["rate<0.001"],
    checks: ["rate>0.999"],
  },
};

function fixedKeyForBuyer(index) {
  const hex = index.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function classify(res) {
  const code = errorCode(res);
  const ok = res.status >= 200 && res.status < 300;
  if (ok) chargeAccepted.add(1);
  else if (code === "INSUFFICIENT_FUNDS") chargeRejectedFunds.add(1);
  else if (code === "RATE_LIMITED") chargeRateLimited.add(1);

  const emulatorAbort = ACCEPT_ABORTS && code === "INTERNAL";
  if (emulatorAbort) contentionAborted.add(1);

  const acceptable =
    ok || code === "INSUFFICIENT_FUNDS" || code === "RATE_LIMITED" || emulatorAbort;
  check(res, { "no unsafe outcome under storm": () => acceptable });
  unexpectedErrors.add(!acceptable);
}

export function contentionIter() {
  const i = exec.scenario.iterationInTest;
  const buyer = pick(fixtures.contention.buyers, i);
  const seller = pick(fixtures.contention.sellers, i);
  classify(charge(seller, paymentCodeOf(buyer)));
}

export function idempotencyIter() {
  const i = exec.scenario.iterationInTest;
  const buyerIndex = Math.floor(i / DUPLICATES_PER_KEY) % fixtures.idempotency.buyers.length;
  const buyer = fixtures.idempotency.buyers[buyerIndex];
  const seller = pick(fixtures.idempotency.sellers, buyerIndex);
  classify(charge(seller, paymentCodeOf(buyer), fixedKeyForBuyer(buyerIndex)));
}
