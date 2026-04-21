import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeModbusPayload } from "./modbus-decoder.ts";

describe("decodeModbusPayload", () => {
  it("decodes configured numeric and boolean registers", () => {
    const decoded = decodeModbusPayload({
      registers: {
        "1": 235,
        "2": "1200",
        "4": 1,
      },
    });

    assert.equal(decoded.status, "decoded");
    assert.deepEqual(
      decoded.registers.map((register) => ({
        address: register.address,
        name: register.name,
        value: register.value,
        displayValue: register.displayValue,
      })),
      [
        {
          address: "1",
          name: "temperature",
          value: 23.5,
          displayValue: undefined,
        },
        {
          address: "2",
          name: "flow",
          value: 12,
          displayValue: undefined,
        },
        {
          address: "4",
          name: "relay_state",
          value: true,
          displayValue: "on",
        },
      ],
    );
  });

  it("marks unknown and invalid registers explicitly", () => {
    const decoded = decodeModbusPayload({
      registers: {
        "999": "mystery",
        "40003": "bad-number",
      },
    });

    assert.equal(decoded.status, "contains_invalid_registers");
    assert.equal(decoded.registers[0]?.status, "unknown");
    assert.equal(decoded.registers[0]?.name, "register_999");
    assert.match(decoded.registers[0]?.error ?? "", /No register mapping/);
    assert.equal(decoded.registers[1]?.status, "invalid");
    assert.equal(decoded.registers[1]?.name, "voltage");
    assert.match(decoded.registers[1]?.error ?? "", /numeric/);
  });

  it("supports nested payload registers and provided values", () => {
    const decoded = decodeModbusPayload({
      payload: {
        registers: {
          "40001": "210",
        },
        values: {
          upstreamName: "already decoded",
        },
      },
    });

    assert.equal(decoded.status, "decoded");
    assert.equal(decoded.registers[0]?.name, "temperature");
    assert.equal(decoded.registers[0]?.value, 21);
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