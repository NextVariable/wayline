export function orderText(value: unknown): string;
export function orderKind(value: unknown): "stay" | "flight" | "rail" | null;
export function serviceNumber(value: unknown, kind: "rail" | "flight"): string;
export function namedRoute(value: unknown): string[];
