import crypto from "k6/crypto";
import http from "k6/http";

export const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const FIXTURES_PATH = __ENV.LOAD_FIXTURES || "./fixtures/load-fixtures.json";

export function loadFixtures() {
  return JSON.parse(open(FIXTURES_PATH));
}

const HEX = "0123456789abcdef";

export function uuidv4() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

function baseHeaders(cookie) {
  return {
    "content-type": "application/json",
    origin: BASE_URL,
    cookie: `__session=${cookie}`,
  };
}

export function post(path, cookie, body, extraHeaders) {
  const headers = baseHeaders(cookie);
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers });
}

export function charge(seller, buyer, key) {
  return post(
    "/api/booth/charge",
    seller.cookie,
    { boothId: seller.boothId, buyer, items: [{ itemId: seller.itemId, qty: 1 }] },
    { "idempotency-key": key || uuidv4() },
  );
}

export function lookup(seller, buyer) {
  return post("/api/booth/lookup", seller.cookie, {
    boothId: seller.boothId,
    buyer,
    cartTotalCents: seller.priceCents,
  });
}

export function topup(sac, buyer, amountCents) {
  return post(
    "/api/sac/topup",
    sac.cookie,
    { buyer, amountCents, method: "cash" },
    { "idempotency-key": uuidv4() },
  );
}

export function errorCode(res) {
  try {
    return JSON.parse(res.body).error?.code || null;
  } catch {
    return null;
  }
}

export function pick(arr, i) {
  return arr[i % arr.length];
}

export function paymentCodeOf(buyer) {
  return { paymentCode: buyer.paymentCode };
}

export function studentNumberOf(buyer) {
  return { studentNumber: buyer.studentNumber };
}
