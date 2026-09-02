import { createHash } from "node:crypto";

const uuidVariant = (hexDigit: string): string =>
  ((Number.parseInt(hexDigit, 16) & 0x3) | 0x8).toString(16);

export const deterministicUuid = (namespace: string, value: string): string => {
  const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${uuidVariant(hex[16] ?? "0")}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};
