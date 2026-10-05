/**
 * A real EAN-13 / UPC-A barcode drawn as SVG bars, so a label with a known UPC carries a scannable code.
 * Anything that isn't 12 or 13 digits renders nothing.
 */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13Bits(code: string): string | null {
  let digits = code.replace(/\D/g, "");
  if (digits.length === 12) digits = "0" + digits;
  if (digits.length !== 13) return null;
  const d = digits.split("").map(Number);
  const parity = PARITY[d[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

export default function Barcode({ code, height = 34, className }: { code: string; height?: number; className?: string }) {
  const bits = ean13Bits(code);
  if (!bits) return null;
  // Guard bars run longer, as printed.
  const guard = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  return (
    <svg className={className} viewBox={`0 0 ${bits.length} ${height + 5}`} width={bits.length * 1.5} height={height + 5} preserveAspectRatio="none" role="img" aria-label={`Barcode ${code}`}>
      {bits.split("").map((b, i) => (b === "1" ? <rect key={i} x={i} y={0} width={1} height={guard.has(i) ? height + 5 : height} fill="currentColor" /> : null))}
    </svg>
  );
}
