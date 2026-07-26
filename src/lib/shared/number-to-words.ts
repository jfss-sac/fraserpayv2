const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

const SCALES = ["", "thousand", "million", "billion"];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${SMALL[hundreds]} hundred`);
  if (rest >= 20) {
    const ones = rest % 10;
    const tens = TENS[Math.floor(rest / 10)]!;
    parts.push(ones > 0 ? `${tens}-${SMALL[ones]}` : tens);
  } else if (rest > 0) {
    parts.push(SMALL[rest]!);
  }
  return parts.join(" ");
}

export function integerToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`integerToWords expects a non-negative integer, got ${n}`);
  }
  if (n === 0) return "zero";

  const groups: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  if (groups.length > SCALES.length) {
    throw new RangeError(`integerToWords does not support numbers this large: ${n}`);
  }

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i]!;
    if (group === 0) continue;
    words.push(SCALES[i] ? `${underThousand(group)} ${SCALES[i]}` : underThousand(group));
  }
  return words.join(" ");
}

export function centsToWords(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`centsToWords expects a non-negative integer, got ${cents}`);
  }
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const parts: string[] = [];
  if (dollars > 0) parts.push(`${integerToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`);
  if (remainder > 0) {
    parts.push(`${integerToWords(remainder)} ${remainder === 1 ? "cent" : "cents"}`);
  }
  if (parts.length === 0) return "zero dollars";
  return parts.join(" and ");
}
