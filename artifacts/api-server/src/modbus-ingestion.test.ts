import assert from "node:assert/strict";
import { describe, it } from "node:test";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:80/api";
const ingestToken =
  process.env.MODBUS_INGEST_TOKEN ?? process.env.TEST_MODBUS_INGEST_TOKEN;

type ApiDecodedRegister = {
  address: string;
  name: string;
  status: string;
  value: unknown;
};

type ApiReading = {
  id: number;
  deviceId: string;
  parsingStatus: string;
  decodedValues: {
    status: string;
    registers: ApiDecodedRegister[];
  };
};

type ModbusReadingAck = {
  accepted: boolean;
  reading: ApiReading;
};

type ModbusReadingList = {
  readings: ApiReading[];
};

describe("POST /api/modbus/readings", () => {
  it("rejects requests without a device token", async () => {
    const response = await fetch(`${apiBaseUrl}/modbus/readings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: `unauthorized-trb246-${Date.now()}`,
        registers: {
          "1": 235,
        },
      }),
    });

    assert.ok(
      response.status === 401 || response.status === 503,
      `Expected 401 or 503, received ${response.status}`,
    );

    const body = (await response.json()) as { error?: string };
    assert.match(body.error ?? "", /token|Unauthorized/i);
  });

  it(
    "persists decoded values and parsing status",
    { skip: ingestToken ? false : "MODBUS_INGEST_TOKEN is required for authenticated ingestion test" },
    async () => {
    const deviceId = `test-trb246-${Date.now()}`;
    const response = await fetch(`${apiBaseUrl}/modbus/readings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": ingestToken ?? "",
      },
      body: JSON.stringify({
        deviceId,
        registers: {
          "1": 235,
          "999": "mystery",
          "40003": "bad-number",
        },
      }),
    });

    assert.equal(response.status, 200);

    const body = (await response.json()) as ModbusReadingAck;
    assert.equal(body.accepted, true);
    assert.equal(body.reading.parsingStatus, "accepted");
    assert.equal(body.reading.decodedValues.status, "contains_invalid_registers");

    const listResponse = await fetch(`${apiBaseUrl}/modbus/readings?limit=10`);
    assert.equal(listResponse.status, 200);

    const listBody = (await listResponse.json()) as ModbusReadingList;
    const storedReading = listBody.readings.find(
      (reading: { id: number }) => reading.id === body.reading.id,
    );
    assert.ok(storedReading);
    assert.equal(storedReading.deviceId, deviceId);
    assert.equal(storedReading.parsingStatus, "accepted");
    assert.equal(storedReading.decodedValues.status, "contains_invalid_registers");
    assert.deepEqual(
      storedReading.decodedValues.registers.map((register) => ({
        address: register.address,
        name: register.name,
        status: register.status,
        value: register.value,
      })),
      [
        {
          address: "1",
          name: "temperature",
          status: "decoded",
          value: 23.5,
        },
        {
          address: "999",
          name: "register_999",
          status: "unknown",
          value: "mystery",
        },
        {
          address: "40003",
          name: "voltage",
          status: "invalid",
          value: null,
        },
      ],
    );
    },
  );
});