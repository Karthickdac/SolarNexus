import { eq } from "drizzle-orm";
import { db, decoderSettingsTable } from "@workspace/db";
import {
  DEFAULT_TRB246_REGISTER_MAP,
  getActiveRegisterMap,
  parseRegisterMap,
  setRegisterMapOverride,
  type RegisterDefinition,
} from "../modbus-decoder";
import { logger } from "./logger";

const SINGLETON_ID = 1;

export type RegisterMapView = {
  registerMap: Record<string, RegisterDefinition>;
  isCustom: boolean;
  updatedAt: string | null;
  updatedBy: number | null;
};

const loadRow = async () => {
  const [row] = await db
    .select()
    .from(decoderSettingsTable)
    .where(eq(decoderSettingsTable.id, SINGLETON_ID))
    .limit(1);
  return row ?? null;
};

/**
 * Read the persisted register-map override from the DB and refresh the
 * in-memory decoder cache. Called once at startup and after every save/reset.
 * Falls back to the default map (and logs) if the stored JSON is somehow
 * invalid, so a bad row can never take ingest down.
 */
export const loadRegisterMapOverride = async (): Promise<void> => {
  try {
    const row = await loadRow();
    if (!row) {
      setRegisterMapOverride(null);
      return;
    }
    setRegisterMapOverride(parseRegisterMap(row.registerMap));
  } catch (err) {
    logger.warn(
      { err },
      "Failed to load persisted register map; using default map.",
    );
    setRegisterMapOverride(null);
  }
};

export const getRegisterMapView = async (): Promise<RegisterMapView> => {
  const row = await loadRow();
  return {
    registerMap: getActiveRegisterMap(),
    isCustom: row != null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    updatedBy: row?.updatedBy ?? null,
  };
};

/**
 * Validate and persist a complete register map, then refresh the cache.
 * Throws (with a user-safe message) when validation fails.
 */
export const saveRegisterMap = async (
  rawMap: unknown,
  userId: number | null,
): Promise<RegisterMapView> => {
  const validated = parseRegisterMap(rawMap);
  await db
    .insert(decoderSettingsTable)
    .values({
      id: SINGLETON_ID,
      registerMap: validated,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: decoderSettingsTable.id,
      set: {
        registerMap: validated,
        updatedAt: new Date(),
        updatedBy: userId,
      },
    });
  await loadRegisterMapOverride();
  return getRegisterMapView();
};

/**
 * Drop any custom override so the decoder reverts to the built-in default.
 */
export const resetRegisterMap = async (): Promise<RegisterMapView> => {
  await db
    .delete(decoderSettingsTable)
    .where(eq(decoderSettingsTable.id, SINGLETON_ID));
  await loadRegisterMapOverride();
  return getRegisterMapView();
};

export const getDefaultRegisterMap = (): Record<string, RegisterDefinition> =>
  DEFAULT_TRB246_REGISTER_MAP;
