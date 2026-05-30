import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeModbusPayload } from "./modbus-decoder.ts";

describe("decodeModbusPayload", () => {
  it("decodes the solar register map with scales", () => {
    const decoded = decodeModbusPayload({
      registers: {
        "5019": "[7942]",
        "5022": "[1232]",
        "5035": 999,
        "5036": 498,
      },
    });

    assert.equal(decoded.status, "decoded");
    assert.deepEqual(
      decoded.registers.map((register) => ({
        address: register.address,
        name: register.name,
        unit: register.unit,
        value: Number(register.value?.toFixed?.(4) ?? register.value),
      })),
      [
        { address: "5019", name: "voltage_a", unit: "V", value: 794.2 },
        { address: "5022", name: "current_a", unit: "A", value: 123.2 },
        { address: "5035", name: "power_factor", unit: null, value: 0.999 },
        { address: "5036", name: "frequency", unit: "Hz", value: 49.8 },
      ],
    );
  });

  it("combines comma-separated 32-bit registers in low/high word order", () => {
    const decoded = decodeModbusPayload({
      registers: {
        "5031": "44259,2",
      },
    });

    assert.equal(decoded.status, "decoded");
    assert.equal(decoded.registers[0]?.name, "power");
    assert.equal(decoded.registers[0]?.unit, "W");
    // low=44259, high=2 -> 2 * 65536 + 44259 = 175331
    assert.equal(decoded.registers[0]?.value, 175331);
  });

  it("treats the all-0xFFFF sentinel as an unavailable value", () => {
    const decoded = decodeModbusPayload(
      {
        registers: {
          "5083": "65535,65535",
        },
      },
      {
        "5083": {
          name: "meter_power",
          unit: "W",
          kind: "number",
          words: 2,
          wordOrder: "lohi",
        },
      },
    );

    assert.equal(decoded.status, "contains_invalid_registers");
    assert.equal(decoded.registers[0]?.status, "invalid");
    assert.match(decoded.registers[0]?.error ?? "", /unavailable/);
  });

  it("marks unknown and invalid registers explicitly", () => {
    const decoded = decodeModbusPayload({
      registers: {
        "999": "mystery",
        "5019": "bad-number",
      },
    });

    assert.equal(decoded.status, "contains_invalid_registers");
    assert.equal(decoded.registers[0]?.status, "unknown");
    assert.equal(decoded.registers[0]?.name, "register_999");
    assert.match(decoded.registers[0]?.error ?? "", /No register mapping/);
    assert.equal(decoded.registers[1]?.status, "invalid");
    assert.equal(decoded.registers[1]?.name, "voltage_a");
    assert.match(decoded.registers[1]?.error ?? "", /numeric/);
  });

  it("supports nested payload registers and provided values", () => {
    const decoded = decodeModbusPayload({
      payload: {
        registers: {
          "5036": "498",
        },
        values: {
          upstreamName: "already decoded",
        },
      },
    });

    assert.equal(decoded.status, "decoded");
    assert.equal(decoded.registers[0]?.name, "frequency");
    assert.equal(Number(decoded.registers[0]?.value?.toFixed(4)), 49.8);
    assert.deepEqual(decoded.providedValues, {
      upstreamName: "already decoded",
    });
  });

  it("returns an explicit no-registers status when no registers are present", () => {
    const decoded = decodeModbusPayload({
      values: {
        upstreamName: "already decoded",
      },
    });

    assert.equal(decoded.status, "no_registers");
    assert.deepEqual(decoded.registers, []);
    assert.deepEqual(decoded.providedValues, {
      upstreamName: "already decoded",
    });
  });

  it("decodes custom register mappings", () => {
    const decoded = decodeModbusPayload(
      {
        registers: {
          "10": "42",
        },
      },
      {
        "10": {
          name: "tank_level",
          unit: "%",
          kind: "number",
          scale: 0.5,
        },
      },
    );

    assert.equal(decoded.status, "decoded");
    assert.equal(decoded.registers[0]?.name, "tank_level");
    assert.equal(decoded.registers[0]?.unit, "%");
    assert.equal(decoded.registers[0]?.value, 21);
  });
});
