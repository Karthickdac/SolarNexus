import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModbusReading } from "@workspace/api-client-react";
import Dashboard from "./dashboard";

type ReadingsResponse = { readings: ModbusReading[] };

type HookResult = {
  data: ReadingsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  dataUpdatedAt: number;
};

const hookState = {
  result: {
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
  } as HookResult,
};

vi.mock("@workspace/api-client-react", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/api-client-react")>(
      "@workspace/api-client-react",
    );
  return {
    ...actual,
    useListModbusReadings: () => hookState.result,
    getListModbusReadingsQueryKey: (params?: unknown) => [
      "/api/modbus/readings",
      params,
    ],
  };
});

function buildReading(overrides: Partial<ModbusReading> = {}): ModbusReading {
  const now = new Date().toISOString();
  return {
    id: 1,
    deviceId: "TRB246-TEST-01",
    source: "127.0.0.1",
    parsingStatus: "accepted",
    receivedAt: now,
    rawPayload: { registers: { "1": 235, "2": 1500, "3": 23000 } },
    decodedValues: {
      status: "decoded",
      providedValues: {},
      registers: [
        {
          address: "1",
          name: "temperature",
          unit: "°C",
          status: "decoded",
          value: 23.5,
          rawValue: 235,
        },
        {
          address: "2",
          name: "flow",
          unit: "L/min",
          status: "decoded",
          value: 15,
          rawValue: 1500,
        },
        {
          address: "3",
          name: "voltage",
          unit: "V",
          status: "decoded",
          value: 230,
          rawValue: 23000,
        },
      ],
    },
    ...overrides,
  };
}

function setHookResult(partial: Partial<HookResult>) {
  hookState.result = { ...hookState.result, ...partial };
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

const consoleErrorSpy = vi.spyOn(console, "error");

beforeEach(() => {
  consoleErrorSpy.mockClear();
});

afterEach(() => {
  setHookResult({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
  });
});

describe("Dashboard", () => {
  it("renders loading state without runtime errors", () => {
    setHookResult({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
      dataUpdatedAt: 0,
    });

    renderDashboard();

    expect(screen.getByText("SolarNexus by Automystics")).toBeInTheDocument();
    expect(screen.getByText(/waiting for data/i)).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders empty state when no readings have arrived", () => {
    setHookResult({
      data: { readings: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
    });

    renderDashboard();

    expect(
      screen.getByText("No TRB246 readings received yet"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Showing/i)).toHaveTextContent(/0 readings/i);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders the populated state with decoded KPI values", () => {
    setHookResult({
      data: { readings: [buildReading()] },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
    });

    renderDashboard();

    expect(
      screen.queryByText("No TRB246 readings received yet"),
    ).not.toBeInTheDocument();
    const tempCard = screen.getByText("Latest Temperature").closest("div");
    expect(tempCard).not.toBeNull();
    expect(within(tempCard as HTMLElement).getByText(/23\.5\s*°C/)).toBeInTheDocument();
    expect(screen.getByText(/Latest Flow/i)).toBeInTheDocument();
    expect(screen.getByText(/Latest Voltage/i)).toBeInTheDocument();
    expect(screen.getByText(/3 registers/i)).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("renders the error state when the readings query fails", () => {
    setHookResult({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network down"),
      dataUpdatedAt: 0,
    });

    renderDashboard();

    expect(
      screen.getByText("Unable to load Modbus readings"),
    ).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("shows the no-decoded-values state in analytics when readings have no decoded metrics", async () => {
    setHookResult({
      data: {
        readings: [
          buildReading({
            decodedValues: {
              status: "no_registers",
              providedValues: {},
              registers: [],
            },
            rawPayload: {},
          }),
        ],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
    });

    const { container } = renderDashboard();

    const analyticsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Analytics");
    expect(analyticsButton).toBeDefined();
    act(() => {
      fireEvent.click(analyticsButton!);
    });

    expect(
      await screen.findByText(
        /Readings are arriving, but no numeric values are decoded yet/i,
      ),
    ).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
