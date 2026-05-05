using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using NModbus;

namespace AgentRelay.Core;

/// <summary>
/// Phase 1 implementation: connects to a Modbus/TCP slave, reads each
/// configured register, decodes it, and pushes the values up to the API
/// server using the device ingest token. Loops every
/// <see cref="ModbusDeviceConfig.PollIntervalSeconds"/>.
///
/// RTU support and per-register batching are deferred to Phase 2.
/// </summary>
public sealed class ModbusRelay
{
    private readonly AppSettings _settings;
    private readonly ApiClient _api;
    private readonly ILogger _logger;

    public ModbusRelay(AppSettings settings, ApiClient api, ILogger logger)
    {
        _settings = settings;
        _api = api;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        _logger.LogInformation("Modbus relay starting with {Count} configured device(s)", _settings.Devices.Count);
        var tasks = _settings.Devices.Select(d => PollDeviceAsync(d, ct)).ToArray();
        await Task.WhenAll(tasks).ConfigureAwait(false);
    }

    private async Task PollDeviceAsync(ModbusDeviceConfig device, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var values = await ReadOnceAsync(device, ct).ConfigureAwait(false);
                if (values.Count > 0)
                {
                    var token = _settings.IngestToken;
                    if (string.IsNullOrEmpty(token))
                    {
                        _logger.LogWarning("Ingest token is not configured; skipping push for {DeviceId}", device.DeviceId);
                    }
                    else
                    {
                        await _api.PushReadingAsync(token, device.DeviceId, values, ct).ConfigureAwait(false);
                        _logger.LogInformation("Pushed {Count} values for {DeviceId}", values.Count, device.DeviceId);
                    }
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Poll failed for {DeviceId}", device.DeviceId);
            }
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(5, device.PollIntervalSeconds)), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task<Dictionary<string, object?>> ReadOnceAsync(ModbusDeviceConfig device, CancellationToken ct)
    {
        var result = new Dictionary<string, object?>();
        if (!string.Equals(device.Transport, "tcp", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Transport {Transport} is not implemented yet; skipping {DeviceId}", device.Transport, device.DeviceId);
            return result;
        }

        using var tcp = new TcpClient();
        await tcp.ConnectAsync(device.Host, device.Port, ct).ConfigureAwait(false);
        var factory = new ModbusFactory();
        var master = factory.CreateMaster(tcp);

        foreach (var reg in device.Registers)
        {
            try
            {
                ushort[] words;
                switch (reg.Type.ToLowerInvariant())
                {
                    case "input":
                        words = master.ReadInputRegisters(device.UnitId, reg.Address, (ushort)Math.Max(1, reg.Length));
                        break;
                    case "holding":
                    default:
                        words = master.ReadHoldingRegisters(device.UnitId, reg.Address, (ushort)Math.Max(1, reg.Length));
                        break;
                }
                result[reg.Name] = Decode(words, reg);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read register {Name}@{Addr}", reg.Name, reg.Address);
                result[reg.Name] = null;
            }
        }
        return result;
    }

    private static object? Decode(ushort[] words, ModbusRegisterConfig reg)
    {
        if (words.Length == 0) return null;
        switch (reg.DataType.ToLowerInvariant())
        {
            case "int16":
                return ((short)words[0]) * reg.Scale;
            case "uint32":
                if (words.Length < 2) return null;
                return ((uint)((words[0] << 16) | words[1])) * reg.Scale;
            case "int32":
                if (words.Length < 2) return null;
                return ((int)((words[0] << 16) | words[1])) * reg.Scale;
            case "float32":
                if (words.Length < 2) return null;
                var bytes = new byte[4];
                bytes[0] = (byte)(words[1] & 0xFF);
                bytes[1] = (byte)(words[1] >> 8);
                bytes[2] = (byte)(words[0] & 0xFF);
                bytes[3] = (byte)(words[0] >> 8);
                return BitConverter.ToSingle(bytes, 0) * reg.Scale;
            case "uint16":
            default:
                return words[0] * reg.Scale;
        }
    }
}
