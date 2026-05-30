import type {
  ModbusReading,
  ModbusDecodedRegister,
} from "@workspace/api-client-react";

export const PRIMARY_DEVICE_ID = "trb246";
export const RAW_DEVICE_ID = "trb246-raw";

export type SolarMetrics = {
  voltageV: number | null;
  powerW: number | null;
  currentA: number | null;
  frequencyHz: number | null;
  powerFactor: number | null;
  reactiveVar: number | null;
  voltageA: number | null;
  voltageB: number | null;
  voltageC: number | null;
};

export type ParsedReading = SolarMetrics & {
  id: number;
  deviceId: string;
  source: string | null;
  receivedAt: string;
  decodedStatus: string;
  parsingStatus: string;
  decodedCount: number;
  decodedRegisters: ModbusDecodedRegister[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getProvidedValues(reading: ModbusReading): Record<string, unknown> {
  if (isRecord(reading.decodedValues?.providedValues)) {
    return reading.decodedValues.providedValues;
  }
  return {};
}

function valueFromMap(
  values: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  const normalized = aliases.map(normalizeKey);
  const entry = Object.entries(values).find(([key]) =>
    normalized.includes(normalizeKey(key)),
  );
  return entry?.[1];
}

function registerValue(
  registers: ModbusDecodedRegister[],
  names: readonly string[],
): number | null {
  const normalized = names.map(normalizeKey);
  const match = registers.find(
    (register) =>
      register.status === "decoded" &&
      normalized.includes(normalizeKey(register.name)),
  );
  return match ? numericValue(match.value) : null;
}

function metric(
  reading: ModbusReading,
  registers: ModbusDecodedRegister[],
  aliases: readonly string[],
  names: readonly string[],
): number | null {
  const provided = numericValue(valueFromMap(getProvidedValues(reading), aliases));
  if (provided !== null) return provided;
  return registerValue(registers, names);
}

export function parseReading(reading: ModbusReading): ParsedReading {
  const registers = reading.decodedValues?.registers ?? [];
  return {
    id: reading.id,
    deviceId: reading.deviceId,
    source: reading.source,
    receivedAt: reading.receivedAt,
    decodedStatus: reading.decodedValues?.status ?? "unknown",
    parsingStatus: reading.parsingStatus,
    decodedCount: registers.filter((r) => r.status === "decoded").length,
    decodedRegisters: registers,
    voltageV: metric(reading, registers, ["voltageV", "voltage"], [
      "voltage",
      "voltage_a",
    ]),
    powerW: metric(reading, registers, ["powerW", "power"], ["power"]),
    currentA: metric(reading, registers, ["currentA", "current"], [
      "current",
      "current_a",
    ]),
    frequencyHz: metric(reading, registers, ["frequencyHz", "frequency"], [
      "frequency",
    ]),
    powerFactor: metric(
      reading,
      registers,
      ["powerFactor", "power_factor", "pf"],
      ["power_factor"],
    ),
    reactiveVar: metric(
      reading,
      registers,
      ["reactiveVar", "reactive", "reactivePower", "reactive_power"],
      ["reactive_power"],
    ),
    voltageA: registerValue(registers, ["voltage_a", "voltagea"]),
    voltageB: registerValue(registers, ["voltage_b", "voltageb"]),
    voltageC: registerValue(registers, ["voltage_c", "voltagec"]),
  };
}

export function minutesSince(iso: string): number {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

export function formatPower(watts: number | null): string {
  if (watts === null) return "--";
  const kw = watts / 1000;
  if (Math.abs(kw) >= 1) return `${kw.toFixed(1)} kW`;
  return `${watts.toFixed(0)} W`;
}

export function formatKw(watts: number | null): number | null {
  return watts === null ? null : watts / 1000;
}

export function formatNumber(
  value: number | null,
  digits = 1,
  suffix = "",
): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}${suffix}`;
}
