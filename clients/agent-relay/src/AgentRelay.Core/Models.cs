using System.Text.Json.Serialization;

namespace AgentRelay.Core;

public record AuthUser(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("siteIds")] List<string> SiteIds);

public record LoginResponse(
    [property: JsonPropertyName("token")] string Token,
    [property: JsonPropertyName("expiresAt")] DateTime ExpiresAt,
    [property: JsonPropertyName("user")] AuthUser User);

public record AuthPingResult(
    [property: JsonPropertyName("reachable")] bool Reachable,
    [property: JsonPropertyName("authenticated")] bool Authenticated,
    [property: JsonPropertyName("user")] AuthUser? User);

public record ModbusReading(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("source")] string? Source,
    [property: JsonPropertyName("parsingStatus")] string ParsingStatus,
    [property: JsonPropertyName("receivedAt")] DateTime ReceivedAt,
    [property: JsonPropertyName("rawPayload")] System.Text.Json.JsonElement? RawPayload,
    [property: JsonPropertyName("decodedValues")] System.Text.Json.JsonElement? DecodedValues);

public record ReadingsList(
    [property: JsonPropertyName("readings")] List<ModbusReading> Readings);

public record DeviceAlertEvent(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("siteId")] string? SiteId,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("triggeredAt")] DateTime TriggeredAt,
    [property: JsonPropertyName("acknowledgedAt")] DateTime? AcknowledgedAt,
    [property: JsonPropertyName("message")] string? Message);

public record AlertEventsList(
    [property: JsonPropertyName("events")] List<DeviceAlertEvent> Events);

public record DeviceSiteAssignment(
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("siteId")] string SiteId);

public record DeviceSiteAssignmentsList(
    [property: JsonPropertyName("assignments")] List<DeviceSiteAssignment> Assignments);

public record SiteThreshold(
    [property: JsonPropertyName("siteId")] string SiteId,
    [property: JsonPropertyName("thresholdMinutes")] int ThresholdMinutes,
    [property: JsonPropertyName("cooldownMinutes")] int? CooldownMinutes);

public record SiteThresholdsList(
    [property: JsonPropertyName("thresholds")] List<SiteThreshold> Thresholds);

/// <summary>
/// Local config for one Modbus register the relay should poll and forward.
/// </summary>
public sealed class ModbusRegisterConfig
{
    public string Name { get; set; } = "";
    public ushort Address { get; set; }
    public string Type { get; set; } = "holding"; // holding | input | coil | discrete
    public int Length { get; set; } = 1;
    public string DataType { get; set; } = "uint16"; // uint16 | int16 | uint32 | int32 | float32
    public double Scale { get; set; } = 1.0;
    public string? Unit { get; set; }
}

/// <summary>
/// Local Modbus device the relay should poll on this machine.
/// </summary>
public sealed class ModbusDeviceConfig
{
    public string DeviceId { get; set; } = "trb246";
    public string? SiteId { get; set; }
    public string Transport { get; set; } = "tcp"; // tcp | rtu
    public string Host { get; set; } = "192.168.1.10";
    public int Port { get; set; } = 502;
    public byte UnitId { get; set; } = 1;
    public int PollIntervalSeconds { get; set; } = 30;
    public List<ModbusRegisterConfig> Registers { get; set; } = new();
}
