export type BlueprintString = {
  id: string;
  name: string;
  inverterId: string;
  deviceId: string;
  mppt: string;
  dcCapacityKw: number;
  expectedPowerW: number;
  x: number;
  y: number;
};

export type BlueprintInverter = {
  id: string;
  name: string;
  block: string;
  deviceId: string;
  x: number;
  y: number;
};

export type BlueprintZone = {
  id: string;
  name: string;
  type: "array" | "inverter-yard" | "control-room" | "grid-yard";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SiteBlueprint = {
  siteName: string;
  clientName: string;
  capacityMw: number;
  location: string;
  zones: BlueprintZone[];
  inverters: BlueprintInverter[];
  strings: BlueprintString[];
};

export const siteBlueprint: SiteBlueprint = {
  siteName: "Client Solar Plant A",
  clientName: "Enterprise Energy Operations",
  capacityMw: 5.2,
  location: "Configurable site layout",
  zones: [
    { id: "pv-field", name: "PV Field", type: "array", x: 3, y: 9, width: 46, height: 76 },
    { id: "inverter-yard", name: "Inverter Yard", type: "inverter-yard", x: 54, y: 14, width: 20, height: 70 },
    { id: "control-room", name: "SCADA / TRB246 Room", type: "control-room", x: 79, y: 12, width: 16, height: 24 },
    { id: "grid-yard", name: "Grid Export Yard", type: "grid-yard", x: 79, y: 48, width: 16, height: 32 },
  ],
  inverters: [
    { id: "inv-01", name: "Inverter 01", block: "Block A", deviceId: "TRB246-GATEWAY-01", x: 59, y: 22 },
    { id: "inv-02", name: "Inverter 02", block: "Block B", deviceId: "TRB246-GATEWAY-02", x: 59, y: 54 },
    { id: "inv-03", name: "Inverter 03", block: "Future Block", deviceId: "TRB246-GATEWAY-03", x: 67, y: 70 },
  ],
  strings: [
    { id: "str-a01", name: "String A-01", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-1", dcCapacityKw: 28, expectedPowerW: 12, x: 5,  y: 14 },
    { id: "str-a02", name: "String A-02", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-1", dcCapacityKw: 28, expectedPowerW: 12, x: 21, y: 14 },
    { id: "str-a03", name: "String A-03", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-2", dcCapacityKw: 28, expectedPowerW: 12, x: 37, y: 14 },
    { id: "str-a04", name: "String A-04", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-2", dcCapacityKw: 28, expectedPowerW: 12, x: 5,  y: 30 },
    { id: "str-a05", name: "String A-05", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-3", dcCapacityKw: 28, expectedPowerW: 12, x: 21, y: 30 },
    { id: "str-a06", name: "String A-06", inverterId: "inv-01", deviceId: "TRB246-GATEWAY-01", mppt: "MPPT-3", dcCapacityKw: 28, expectedPowerW: 12, x: 37, y: 30 },
    { id: "str-b01", name: "String B-01", inverterId: "inv-02", deviceId: "TRB246-GATEWAY-02", mppt: "MPPT-1", dcCapacityKw: 28, expectedPowerW: 12, x: 5,  y: 46 },
    { id: "str-b02", name: "String B-02", inverterId: "inv-02", deviceId: "TRB246-GATEWAY-02", mppt: "MPPT-1", dcCapacityKw: 28, expectedPowerW: 12, x: 21, y: 46 },
    { id: "str-b03", name: "String B-03", inverterId: "inv-02", deviceId: "TRB246-GATEWAY-02", mppt: "MPPT-2", dcCapacityKw: 28, expectedPowerW: 12, x: 37, y: 46 },
    { id: "str-b04", name: "String B-04", inverterId: "inv-02", deviceId: "TRB246-GATEWAY-02", mppt: "MPPT-2", dcCapacityKw: 28, expectedPowerW: 12, x: 5,  y: 62 },
    { id: "str-b05", name: "String B-05", inverterId: "inv-02", deviceId: "TRB246-GATEWAY-02", mppt: "MPPT-3", dcCapacityKw: 28, expectedPowerW: 12, x: 21, y: 62 },
    { id: "str-c01", name: "String C-01", inverterId: "inv-03", deviceId: "TRB246-GATEWAY-03", mppt: "MPPT-1", dcCapacityKw: 28, expectedPowerW: 12, x: 37, y: 62 },
  ],
};