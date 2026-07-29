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

const DURATION = __ENV.DURATION || "10m";
const CHARGE_RATE = Number(__ENV.CHARGE_RATE || 10);
const LOOKUP_RATE = Number(__ENV.LOOKUP_RATE || 2);
const TOPUP_RATE_PER_MIN = Number(__ENV.TOPUP_RATE_PER_MIN || 30);
const TOPUP_AMOUNT_CENTS = Number(__ENV.TOPUP_AMOUNT_CENTS || 500);

const fixtures = loadFixtures();

const unexpectedErrors = new Rate("unexpected_errors");
const insufficientFunds = new Counter("insufficient_funds");

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
      preAllocatedVUs: 10,
      maxVUs: 50,
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

function classify(res) {
  const code = errorCode(res);
  if (code === "INSUFFICIENT_FUNDS") {
    insufficientFunds.add(1);
    unexpectedErrors.add(0);
    return;
  }
  unexpectedErrors.add(res.status < 200 || res.status >= 300);
}

export function chargeIter() {
  const i = exec.scenario.iterationInTest;
  const seller = pick(fixtures.charge.sellers, i);
  const buyer = pick(fixtures.charge.buyers, i);
  const ref = i % 2 === 0 ? paymentCodeOf(buyer) : studentNumberOf(buyer);
  classify(charge(seller, ref));
}

export function lookupIter() {
  const i = exec.scenario.iterationInTest;
  const seller = pick(fixtures.charge.sellers, i * 7 + 1);
  const buyer = pick(fixtures.charge.buyers, i * 3 + 2);
  classify(lookup(seller, paymentCodeOf(buyer)));
}

export function topupIter() {
  const i = exec.scenario.iterationInTest;
  const sac = pick(fixtures.topup.sacMembers, i);
  const buyer = pick(fixtures.topup.buyers, i);
  classify(topup(sac, studentNumberOf(buyer), TOPUP_AMOUNT_CENTS));
}
