import type { ModbusDecodedValues } from "@workspace/db";

export type RegisterDefinition = {
  name: string;
  unit: string | null;
  kind: "number" | "boolean";
  scale?: number;
  /** Number of 16-bit Modbus words this value spans (1 = 16-bit, 2 = 32-bit). */
  words?: number;
  /** Word order when combining a 32-bit value: "lohi" (default) or "hilo". */
  wordOrder?: "lohi" | "hilo";
  labels?: Record<string, string>;
};

// Register map for the SolarNexus TRB246 three-phase inverter/meter.
// Keyed by Modbus register address. Scales were calibrated against the
// captured device data and cross-checked against three-phase power
// (P ≈ √3 · V · I · PF), so they can be tuned via TRB246_REGISTER_MAP_JSON
// if the inverter's own display disagrees.
export const DEFAULT_TRB246_REGISTER_MAP: Record<string, RegisterDefinition> = {
  "5019": { name: "voltage_a", unit: "V", kind: "number", scale: 0.1 },
  "5020": { name: "voltage_b", unit: "V", kind: "number", scale: 0.1 },
  "5021": { name: "voltage_c", unit: "V", kind: "number", scale: 0.1 },
  "5022": { name: "current_a", unit: "A", kind: "number", scale: 0.1 },
  "5023": { name: "current_b", unit: "A", kind: "number", scale: 0.1 },
  "5024": { name: "current_c", unit: "A", kind: "number", scale: 0.1 },
  "5031": {
    name: "power",
    unit: "W",
    kind: "number",
    words: 2,
    wordOrder: "lohi",
  },
  "5033": {
    name: "reactive_power",
    unit: "var",
    kind: "number",
    words: 2,
    wordOrder: "lohi",
  },
  "5035": { name: "power_factor", unit: null, kind: "number", scale: 0.001 },
  "5036": { name: "frequency", unit: "Hz", kind: "number", scale: 0.1 },
};

const parseRegisterDefinition = (
  address: string,
  definition: unknown,
): RegisterDefinition => {
  if (!isRecord(definition)) {
    throw new Error(`TRB246 register "${address}" must be an object.`);
  }

  const { name, unit, kind, scale, words, wordOrder, labels } = definition;

  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(`TRB246 register "${address}" must include a name.`);
  }

  if (unit !== null && typeof unit !== "string") {
    throw new Error(`TRB246 register "${address}" unit must be a string or null.`);
  }

  if (kind !== "number" && kind !== "boolean") {
    throw new Error(`TRB246 register "${address}" kind must be number or boolean.`);
  }

  if (scale !== undefined && (typeof scale !== "number" || !Number.isFinite(scale))) {
    throw new Error(`TRB246 register "${address}" scale must be a finite number.`);
  }

  if (
    words !== undefined &&
    (typeof words !== "number" || !Number.isInteger(words) || words < 1 || words > 2)
  ) {
    throw new Error(`TRB246 register "${address}" words must be 1 or 2.`);
  }

  if (wordOrder !== undefined && wordOrder !== "lohi" && wordOrder !== "hilo") {
    throw new Error(`TRB246 register "${address}" wordOrder must be "lohi" or "hilo".`);
  }

  if (labels !== undefined && !isRecord(labels)) {
    throw new Error(`TRB246 register "${address}" labels must be an object.`);
  }

  const parsedLabels =
    labels === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(labels).map(([labelKey, labelValue]) => {
            if (typeof labelValue !== "string") {
              throw new Error(
                `TRB246 register "${address}" label "${labelKey}" must be a string.`,
              );
            }

            return [labelKey, labelValue];
          }),
        );

  return {
    name,
    unit,
    kind,
    ...(scale === undefined ? {} : { scale }),
    ...(words === undefined ? {} : { words }),
    ...(wordOrder === undefined ? {} : { wordOrder }),
    ...(parsedLabels === undefined ? {} : { labels: parsedLabels }),
  };
};

export const getTrb246RegisterMap = () => {
  const rawMap = process.env.TRB246_REGISTER_MAP_JSON;

  if (!rawMap) {
    return DEFAULT_TRB246_REGISTER_MAP;
  }

  const parsedMap = JSON.parse(rawMap);

  if (!isRecord(parsedMap)) {
    throw new Error("TRB246_REGISTER_MAP_JSON must be a JSON object.");
  }

  return {
    ...DEFAULT_TRB246_REGISTER_MAP,
    ...Object.fromEntries(
      Object.entries(parsedMap).map(([address, definition]) => [
        address,
        parseRegisterDefinition(address, definition),
      ]),
    ),
  };
};

/**
 * Validate a complete register map object (every address → definition).
 * Used by the dashboard-driven editor before persisting the override.
 * Throws on the first invalid entry; the message is safe to surface.
 */
export const parseRegisterMap = (
  raw: unknown,
): Record<string, RegisterDefinition> => {
  if (!isRecord(raw)) {
    throw new Error("Register map must be a JSON object keyed by address.");
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new Error("Register map must contain at least one register.");
  }

  return Object.fromEntries(
    entries.map(([address, definition]) => {
      if (!/^\d+$/.test(address.trim())) {
        throw new Error(
          `Register address "${address}" must be a numeric Modbus address.`,
        );
      }
      return [address.trim(), parseRegisterDefinition(address, definition)];
    }),
  );
};

/**
 * Runtime override for the active register map, populated from the DB on
 * startup and refreshed whenever an admin edits the map. `decodeModbusPayload`
 * runs on the ingest hot path, so we cache the validated map in memory rather
 * than reading the DB per request. `null` means "fall back to the env/default
 * map" (see {@link getActiveRegisterMap}).
 */
let activeMapOverride: Record<string, RegisterDefinition> | null = null;

export const setRegisterMapOverride = (
  map: Record<string, RegisterDefinition> | null,
): void => {
  activeMapOverride = map;
};

export const getActiveRegisterMap = (): Record<string, RegisterDefinition> =>
  activeMapOverride ?? getTrb246RegisterMap();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const getRegisters = (payload: Record<string, unknown>) => {
  if (isRecord(payload.registers)) {
    return payload.registers;
  }

  if (isRecord(payload.payload) && isRecord(payload.payload.registers)) {
    return payload.payload.registers;
  }

  return null;
};

const getProvidedValues = (payload: Record<string, unknown>) => {
  if (isRecord(payload.values)) {
    return payload.values;
  }

  if (isRecord(payload.payload) && isRecord(payload.payload.values)) {
    return payload.payload.values;
  }

  return {};
};

const parseNumber = (rawValue: unknown) => {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const numericValue = Number(rawValue.trim());
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
};

/**
 * The TRB246 emits raw register values as scalars (`498`), bracketed
 * single registers (`[1266]`), or comma-separated word lists for
 * multi-register reads (`44259,2`). Normalise any of these into an array
 * of 16-bit word numbers, or null when nothing parses.
 */
const parseRegisterWords = (rawValue: unknown): number[] | null => {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return [rawValue];
  }

  if (Array.isArray(rawValue)) {
    const words = rawValue.map(parseNumber);
    return words.every((word): word is number => word != null) && words.length > 0
      ? words
      : null;
  }

  if (typeof rawValue === "string") {
    const stripped = rawValue.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (stripped === "") return null;
    const words = stripped.split(",").map((part) => parseNumber(part.trim()));
    return words.every((word): word is number => word != null) && words.length > 0
      ? words
      : null;
  }

  return null;
};

const UINT16_SENTINEL = 0xffff;

/**
 * Combine raw words into a single number using the register's width and
 * word order. Returns null when the value is the all-0xFFFF "unavailable"
 * sentinel the device sends for registers it could not read.
 */
const combineWords = (
  words: number[],
  definition: RegisterDefinition,
): number | null => {
  const width = definition.words ?? 1;

  if (words.every((word) => word === UINT16_SENTINEL)) {
    return null;
  }

  if (width === 2 && words.length >= 2) {
    const [first = 0, second = 0] = words;
    const [low, high] =
      definition.wordOrder === "hilo" ? [second, first] : [first, second];
    return high * 0x10000 + low;
  }

  return words[0] ?? null;
};

const parseBoolean = (rawValue: unknown) => {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  if (typeof rawValue === "number") {
    if (rawValue === 0) {
      return false;
    }

    if (rawValue === 1) {
      return true;
    }
  }

  if (typeof rawValue === "string") {
    const normalizedValue = rawValue.trim().toLowerCase();
    if (["0", "false", "off", "normal", "inactive"].includes(normalizedValue)) {
      return false;
    }

    if (["1", "true", "on", "alarm", "active"].includes(normalizedValue)) {
      return true;
    }
  }

  return null;
};

export const decodeModbusPayload = (
  payload: Record<string, unknown>,
  registerMap = getActiveRegisterMap(),
): ModbusDecodedValues => {
  const registers = getRegisters(payload);
  const providedValues = getProvidedValues(payload);

  if (!registers || Object.keys(registers).length === 0) {
    return {
      status: "no_registers",
      registers: [],
      providedValues,
    };
  }

  const decodedRegisters = Object.entries(registers).map(([address, rawValue]) => {
    const definition = registerMap[address];

    if (!definition) {
      return {
        address,
        name: `register_${address}`,
        unit: null,
        status: "unknown" as const,
        value:
          typeof rawValue === "string" ||
          typeof rawValue === "number" ||
          typeof rawValue === "boolean" ||
          rawValue === null
            ? rawValue
            : null,
        rawValue,
        error: "No register mapping is configured for this address.",
      };
    }

    if (definition.kind === "boolean") {
      const booleanValue = parseBoolean(rawValue);

      if (booleanValue == null) {
        return {
          address,
          name: definition.name,
          unit: definition.unit,
          status: "invalid" as const,
          value: null,
          rawValue,
          error: "Expected a boolean-like value.",
        };
      }

      return {
        address,
        name: definition.name,
        unit: definition.unit,
        status: "decoded" as const,
        value: booleanValue,
        rawValue,
        displayValue: definition.labels?.[String(booleanValue)],
      };
    }

    const words = parseRegisterWords(rawValue);

    if (words == null) {
      return {
        address,
        name: definition.name,
        unit: definition.unit,
        status: "invalid" as const,
        value: null,
        rawValue,
        error: "Expected a numeric value.",
      };
    }

    const combined = combineWords(words, definition);

    if (combined == null) {
      return {
        address,
        name: definition.name,
        unit: definition.unit,
        status: "invalid" as const,
        value: null,
        rawValue,
        error: "Register reported an unavailable (0xFFFF) value.",
      };
    }

    return {
      address,
      name: definition.name,
      unit: definition.unit,
      status: "decoded" as const,
      value: combined * (definition.scale ?? 1),
      rawValue,
    };
  });

  const hasInvalidRegister = decodedRegisters.some(
    (register) => register.status === "invalid",
  );
  const hasUnknownRegister = decodedRegisters.some(
    (register) => register.status === "unknown",
  );

  return {
    status: hasInvalidRegister
      ? "contains_invalid_registers"
      : hasUnknownRegister
        ? "contains_unknown_registers"
        : "decoded",
    registers: decodedRegisters,
    providedValues,
  };
};