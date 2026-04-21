import type { ModbusDecodedValues } from "@workspace/db";

type RegisterDefinition = {
  name: string;
  unit: string | null;
  kind: "number" | "boolean";
  scale?: number;
  labels?: Record<string, string>;
};

export const DEFAULT_TRB246_REGISTER_MAP: Record<string, RegisterDefinition> = {
  "1": { name: "temperature", unit: "°C", kind: "number", scale: 0.1 },
  "2": { name: "flow", unit: "L/min", kind: "number", scale: 0.01 },
  "3": { name: "voltage", unit: "V", kind: "number", scale: 0.001 },
  "4": {
    name: "relay_state",
    unit: null,
    kind: "boolean",
    labels: { false: "off", true: "on" },
  },
  "5": {
    name: "alarm_state",
    unit: null,
    kind: "boolean",
    labels: { false: "normal", true: "alarm" },
  },
  "40001": { name: "temperature", unit: "°C", kind: "number", scale: 0.1 },
  "40002": { name: "flow", unit: "L/min", kind: "number", scale: 0.01 },
  "40003": { name: "voltage", unit: "V", kind: "number", scale: 0.001 },
  "40004": {
    name: "relay_state",
    unit: null,
    kind: "boolean",
    labels: { false: "off", true: "on" },
  },
  "40005": {
    name: "alarm_state",
    unit: null,
    kind: "boolean",
    labels: { false: "normal", true: "alarm" },
  },
};

const parseRegisterDefinition = (
  address: string,
  definition: unknown,
): RegisterDefinition => {
  if (!isRecord(definition)) {
    throw new Error(`TRB246 register "${address}" must be an object.`);
  }

  const { name, unit, kind, scale, labels } = definition;

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
  registerMap = getTrb246RegisterMap(),
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

    const numericValue = parseNumber(rawValue);

    if (numericValue == null) {
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

    return {
      address,
      name: definition.name,
      unit: definition.unit,
      status: "decoded" as const,
      value: numericValue * (definition.scale ?? 1),
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