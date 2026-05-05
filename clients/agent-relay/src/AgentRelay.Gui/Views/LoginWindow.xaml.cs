using System.Windows;
using AgentRelay.Core;

namespace AgentRelay.Gui.Views;

public partial class LoginWindow : Window
{
    public LoginWindow()
    {
        InitializeComponent();
        UrlBox.Text = App.Settings.ApiBaseUrl;
        EmailBox.Text = App.Settings.UserEmail ?? "";
    }

    private void QuitButton_Click(object sender, RoutedEventArgs e) => Application.Current.Shutdown();

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "";
        LoginButton.IsEnabled = false;
        try
        {
            var url = UrlBox.Text.Trim();
            var email = EmailBox.Text.Trim();
            var password = PasswordBox.Password;
            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
            {
                StatusText.Text = "URL, email and password are required.";
                return;
            }

            App.Settings.ApiBaseUrl = url;
            App.Api = new ApiClient(url);
            var result = await App.Api.LoginAsync(email, password);
            App.Settings.SessionToken = result.Token;
            App.Settings.SessionExpiresAt = result.ExpiresAt;
            App.Settings.UserEmail = result.User.Email;
            App.Settings.UserName = result.User.Name;
            App.Settings.UserRole = result.User.Role;
            App.Settings.Save();

            var main = new MainWindow();
            Application.Current.MainWindow = main;
            main.Show();
            Close();
        }
        catch (ApiException ex)
        {
            StatusText.Text = ex.Message;
        }
        catch (System.Exception ex)
        {
            StatusText.Text = "Connection failed: " + ex.Message;
        }
        finally
        {
            LoginButton.IsEnabled = true;
        }
    }
}
