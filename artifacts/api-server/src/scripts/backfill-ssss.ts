/**
 * One-time backfill for the captured TRB246 "ssss" fragments.
 *
 * The TRB246 streamed one register per HTTP POST as
 * `{"ssss":[{"data":"<value>"}]}`. Reads arrive in a fixed poll order, so
 * every 9 consecutive fragments form one complete measurement cycle. This
 * script groups the raw fragments into cycles, maps each position to its
 * Modbus register address, decodes the cycle with the shared decoder, and
 * inserts one consolidated snapshot reading per cycle so the dashboard can
 * render full solar metrics (voltage, current, power, PF, frequency).
 *
 * The original fragments are preserved (relabelled to device "trb246-raw")
 * rather than deleted. Re-running the script is safe: it removes its own
 * previously inserted snapshots first.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec node \
 *     --experimental-strip-types src/scripts/backfill-ssss.ts
 */
import { and, eq } from "drizzle-orm";
import { db, modbusReadingsTable, pool } from "@workspace/db";
import { decodeModbusPayload } from "../modbus-decoder.ts";

const SNAPSHOT_DEVICE_ID = "trb246";
const RAW_DEVICE_ID = "trb246-raw";
const BACKFILL_SOURCE = "backfill:ssss";
const CYCLE_GAP_MS = 2000;
const CYCLE_LENGTH = 9;

// Fixed poll order -> Modbus register address. Position 8 is the device's
// unavailable (0xFFFF) register and is intentionally dropped.
const POSITION_TO_ADDRESS: Record<number, string> = {
  0: "5035", // power_factor
  1: "5022", // current_a
  2: "5019", // voltage_a
  3: "5020", // voltage_b
  4: "5021", // voltage_c
  5: "5031", // power (32-bit)
  6: "5033", // reactive_power
  7: "5036", // frequency
};

type Fragment = {
  id: number;
  receivedAt: string;
  orgId: number | null;
  data: string;
};

const valueByName = (
  decoded: ReturnType<typeof decodeModbusPayload>,
  name: string,
): number | null => {
  const register = decoded.registers.find((r) => r.name === name);
  return register && register.status === "decoded" && typeof register.value === "number"
    ? register.value
    : null;
};

const main = async () => {
  const { rows } = await pool.query<Fragment>(
    `SELECT id,
            received_at AS "receivedAt",
            org_id AS "orgId",
            raw_payload->'ssss'->0->>'data' AS data
     FROM modbus_readings
     WHERE raw_payload ? 'ssss'
     ORDER BY received_at ASC`,
  );

  console.log(`Found ${rows.length} raw ssss fragments.`);
  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Group fragments into cycles by time gap.
  const cycles: Fragment[][] = [];
  let current: Fragment[] = [];
  let prevTime: number | null = null;
  for (const row of rows) {
    const time = new Date(row.receivedAt).getTime();
    if (prevTime !== null && time - prevTime > CYCLE_GAP_MS) {
      if (current.length > 0) cycles.push(current);
      current = [];
    }
    current.push(row);
    prevTime = time;
  }
  if (current.length > 0) cycles.push(current);

  const fullCycles = cycles.filter((cycle) => cycle.length === CYCLE_LENGTH);
  console.log(
    `Grouped into ${cycles.length} cycles; ${fullCycles.length} are complete (${CYCLE_LENGTH} values).`,
  );

  const orgId = rows[0]?.orgId ?? null;

  // Remove snapshots from a previous run so the script is idempotent.
  const deleted = await db
    .delete(modbusReadingsTable)
    .where(
      and(
        eq(modbusReadingsTable.deviceId, SNAPSHOT_DEVICE_ID),
        eq(modbusReadingsTable.source, BACKFILL_SOURCE),
      ),
    )
    .returning({ id: modbusReadingsTable.id });
  if (deleted.length > 0) {
    console.log(`Removed ${deleted.length} snapshots from a previous run.`);
  }

  let inserted = 0;
  for (const cycle of fullCycles) {
    const registers: Record<string, string> = {};
    for (let pos = 0; pos < CYCLE_LENGTH; pos++) {
      const address = POSITION_TO_ADDRESS[pos];
      if (!address) continue; // skip unavailable position 8
      registers[address] = cycle[pos]!.data;
    }

    const rawPayload = { registers, source: BACKFILL_SOURCE };
    const decoded = decodeModbusPayload(rawPayload);

    const providedValues = {
      voltageV: valueByName(decoded, "voltage_a"),
      powerW: valueByName(decoded, "power"),
      currentA: valueByName(decoded, "current_a"),
      frequencyHz: valueByName(decoded, "frequency"),
      powerFactor: valueByName(decoded, "power_factor"),
      reactiveVar: valueByName(decoded, "reactive_power"),
    };

    await db.insert(modbusReadingsTable).values({
      orgId,
      deviceId: SNAPSHOT_DEVICE_ID,
      source: BACKFILL_SOURCE,
      parsingStatus: "accepted",
      tokenSlot: null,
      rawPayload,
      decodedValues: { ...decoded, providedValues },
      receivedAt: new Date(cycle[cycle.length - 1]!.receivedAt),
    });
    inserted++;
  }

  console.log(`Inserted ${inserted} consolidated snapshot readings.`);

  // Preserve the raw fragments under a separate device id so they no longer
  // clutter the main dashboard but remain available for inspection.
  const relabelled = await pool.query(
    `UPDATE modbus_readings
     SET device_id = $1
     WHERE raw_payload ? 'ssss' AND device_id <> $1`,
    [RAW_DEVICE_ID],
  );
  console.log(`Relabelled ${relabelled.rowCount} raw fragments to "${RAW_DEVICE_ID}".`);
};

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
