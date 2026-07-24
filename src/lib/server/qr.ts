import "server-only";

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

const DATA_CODEWORDS: Record<number, number> = { 1: 16, 2: 28, 3: 44 };
const EC_CODEWORDS: Record<number, number> = { 1: 10, 2: 16, 3: 26 };
const ALIGN_POSITIONS: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22] };

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let a = 0; a < poly.length; a++) {
      next[a] ^= gfMul(poly[a], 1);
      next[a + 1] ^= gfMul(poly[a], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const buf = data.concat(new Array<number>(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return buf.slice(data.length);
}

function chooseVersion(byteLen: number): number {
  for (const version of [1, 2, 3]) {
    if (byteLen <= DATA_CODEWORDS[version] - 2) return version;
  }
  throw new RangeError(`QR payload too large: ${byteLen} bytes`);
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const capacityBits = DATA_CODEWORDS[version] * 8;
  const bits: number[] = [];
  const push = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  const pad = [0xec, 0x11];
  for (let i = 0; codewords.length < DATA_CODEWORDS[version]; i++) codewords.push(pad[i % 2]);
  return codewords;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly fixed: boolean[][];

  constructor(version: number) {
    this.size = 17 + 4 * version;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private setFunction(row: number, col: number, dark: boolean): void {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return;
    this.modules[row][col] = dark;
    this.fixed[row][col] = true;
  }

  private placeFinder(row: number, col: number): void {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        this.setFunction(row + r, col + c, dark);
      }
    }
  }

  private placeAlignment(centerRow: number, centerCol: number): void {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        this.setFunction(centerRow + r, centerCol + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
  }

  drawFunctionPatterns(version: number): void {
    this.placeFinder(0, 0);
    this.placeFinder(0, this.size - 7);
    this.placeFinder(this.size - 7, 0);

    for (let i = 8; i < this.size - 8; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }

    const positions = ALIGN_POSITIONS[version];
    const last = this.size - 8;
    for (const pr of positions) {
      for (const pc of positions) {
        if ((pr <= 7 && pc <= 7) || (pr <= 7 && pc >= last) || (pr >= last && pc <= 7)) continue;
        this.placeAlignment(pr, pc);
      }
    }

    this.setFunction(this.size - 8, 8, true);
    this.drawFormatBits(0);
  }

  drawFormatBits(mask: number): void {
    const data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >> i) & 1) !== 0;

    const copy1: [number, number][] = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8],
    ];
    for (let k = 0; k < 15; k++) this.setFunction(copy1[k][0], copy1[k][1], bit(14 - k));

    for (let k = 0; k < 7; k++) this.setFunction(this.size - 1 - k, 8, bit(14 - k));
    for (let k = 0; k < 8; k++) this.setFunction(8, this.size - 8 + k, bit(7 - k));
    this.setFunction(this.size - 8, 8, true);
  }

  drawCodewords(bitstream: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j;
          const upward = ((right + 1) & 2) === 0;
          const row = upward ? this.size - 1 - vert : vert;
          if (!this.fixed[row][col] && i < bitstream.length) {
            this.modules[row][col] = bitstream[i] === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.fixed[row][col]) continue;
        let invert = false;
        switch (mask) {
          case 0:
            invert = (row + col) % 2 === 0;
            break;
          case 1:
            invert = row % 2 === 0;
            break;
          case 2:
            invert = col % 3 === 0;
            break;
          case 3:
            invert = (row + col) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
            break;
          case 5:
            invert = ((row * col) % 2) + ((row * col) % 3) === 0;
            break;
          case 6:
            invert = (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
            break;
          default:
            invert = (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
            break;
        }
        if (invert) this.modules[row][col] = !this.modules[row][col];
      }
    }
  }

  penalty(): number {
    let result = 0;
    const size = this.size;

    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.addHistory(runLen, history);
          if (!runColor) result += this.countPatterns(history) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
      result += this.terminateAndCount(runColor, runLen, history) * PENALTY_N3;
    }

    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.addHistory(runLen, history);
          if (!runColor) result += this.countPatterns(history) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
      result += this.terminateAndCount(runColor, runLen, history) * PENALTY_N3;
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }

    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (this.modules[y][x]) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  private addHistory(runLen: number, history: number[]): void {
    if (history[0] === 0) runLen += this.size;
    history.pop();
    history.unshift(runLen);
  }

  private countPatterns(history: number[]): number {
    const n = history[1];
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  }

  private terminateAndCount(runColor: boolean, runLen: number, history: number[]): number {
    if (runColor) {
      this.addHistory(runLen, history);
      runLen = 0;
    }
    runLen += this.size;
    this.addHistory(runLen, history);
    return this.countPatterns(history);
  }
}

export function encodeQrMatrix(data: string): QrMatrix {
  const bytes = new TextEncoder().encode(data);
  const version = chooseVersion(bytes.length);
  const dataCodewords = encodeData(bytes, version);
  const ecCodewords = rsEncode(dataCodewords, EC_CODEWORDS[version]);
  const codewords = dataCodewords.concat(ecCodewords);

  const bitstream: number[] = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i--) bitstream.push((codeword >> i) & 1);
  }

  const grid = new Grid(version);
  grid.drawFunctionPatterns(version);
  grid.drawCodewords(bitstream);

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    grid.drawFormatBits(mask);
    grid.applyMask(mask);
    const penalty = grid.penalty();
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    grid.applyMask(mask);
  }
  grid.drawFormatBits(bestMask);
  grid.applyMask(bestMask);

  return { size: grid.size, modules: grid.modules };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPaymentQrSvg(
  data: string,
  opts: { quietZone?: number; label?: string } = {},
): string {
  const { size, modules } = encodeQrMatrix(data);
  const quiet = opts.quietZone ?? 4;
  const dim = size + quiet * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const label = escapeXml(opts.label ?? "Payment QR code");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img" aria-label="${label}">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`
  );
}
