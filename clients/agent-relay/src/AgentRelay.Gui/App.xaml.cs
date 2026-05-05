using System.Windows;
using AgentRelay.Core;
using AgentRelay.Gui.Views;

namespace AgentRelay.Gui;

public partial class App : Application
{
    public static AppSettings Settings { get; set; } = new();
    public static ApiClient Api { get; set; } = default!;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Settings = AppSettings.Load();
        Api = new ApiClient(Settings.ApiBaseUrl, Settings.SessionToken);

        var hasValidSession =
            !string.IsNullOrEmpty(Settings.SessionToken) &&
            Settings.SessionExpiresAt.HasValue &&
            Settings.SessionExpiresAt.Value > DateTime.UtcNow.AddMinutes(1);

        Window first = hasValidSession
            ? new MainWindow()
            : new LoginWindow();
        MainWindow = first;
        first.Show();
    }
}
