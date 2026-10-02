using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using MediaColor = System.Windows.Media.Color;

namespace ZodiakInstaller;

public partial class MainWindow : Window
{
    private const string CurrentUserPath = "%LocalAppData%\\Programs\\zodiak";
    private const string AllUsersPath = "%ProgramFiles%\\zodiak";
    private bool installForAllUsers;
    private bool isInstalling;

    public MainWindow()
    {
        InitializeComponent();
        InstallPathText.Text = Environment.ExpandEnvironmentVariables(CurrentUserPath);
        VersionText.Text = $"v{GetDisplayVersion()}";
        UpdateScopeButtons();
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton == MouseButtonState.Pressed)
        {
            DragMove();
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        if (!isInstalling)
        {
            Close();
        }
    }

    private void JustMe_Click(object sender, RoutedEventArgs e)
    {
        installForAllUsers = false;
        InstallPathText.Text = Environment.ExpandEnvironmentVariables(CurrentUserPath);
        UpdateScopeButtons();
    }

    private void AllUsers_Click(object sender, RoutedEventArgs e)
    {
        installForAllUsers = true;
        InstallPathText.Text = Environment.ExpandEnvironmentVariables(AllUsersPath);
        UpdateScopeButtons();
    }

    private void UpdateScopeButtons()
    {
        var selectedBrush = new SolidColorBrush(MediaColor.FromRgb(48, 44, 69));
        var selectedBorder = new SolidColorBrush(MediaColor.FromRgb(168, 160, 255));
        var idleBrush = new SolidColorBrush(MediaColor.FromRgb(25, 26, 32));
        var idleBorder = new SolidColorBrush(MediaColor.FromRgb(53, 54, 66));

        JustMeButton.Background = installForAllUsers ? idleBrush : selectedBrush;
        JustMeButton.BorderBrush = installForAllUsers ? idleBorder : selectedBorder;
        AllUsersButton.Background = installForAllUsers ? selectedBrush : idleBrush;
        AllUsersButton.BorderBrush = installForAllUsers ? selectedBorder : idleBorder;
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "Choose where to install zodiak",
            InitialDirectory = InstallPathText.Text,
            UseDescriptionForTitle = true,
        };

        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            InstallPathText.Text = dialog.SelectedPath;
        }
    }

    private async void Install_Click(object sender, RoutedEventArgs e)
    {
        var installPath = InstallPathText.Text.Trim();
        if (string.IsNullOrWhiteSpace(installPath) || !Path.IsPathFullyQualified(installPath))
        {
            StatusText.Visibility = Visibility.Visible;
            StatusText.Text = "Choose a valid absolute installation folder.";
            StatusText.Foreground = new SolidColorBrush(MediaColor.FromRgb(241, 123, 135));
            return;
        }

        try
        {
            SetInstallingState(true, "Installing…");
            var exitCode = await RunCoreInstallerAsync(installPath, installForAllUsers, false);
            if (exitCode != 0)
            {
                throw new InvalidOperationException($"The installer exited with code {exitCode}.");
            }

            StatusText.Text = "zodiak is installed. Launching it now…";
            TryLaunchInstalledApp(installPath);
            Close();
        }
        catch (Exception exception)
        {
            SetInstallingState(false, "Installation could not be completed. Please try again.");
            StatusText.Foreground = new SolidColorBrush(MediaColor.FromRgb(241, 123, 135));
            Debug.WriteLine(exception);
        }
    }

    private void SetInstallingState(bool installing, string status)
    {
        isInstalling = installing;
        InstallButton.IsEnabled = !installing;
        InstallButton.Content = installing ? "Installing…" : "Install";
        JustMeButton.IsEnabled = !installing;
        AllUsersButton.IsEnabled = !installing;
        InstallPathText.IsEnabled = !installing;
        InstallProgress.Visibility = installing ? Visibility.Visible : Visibility.Hidden;
        StatusText.Visibility = string.IsNullOrWhiteSpace(status) ? Visibility.Hidden : Visibility.Visible;
        StatusText.Foreground = new SolidColorBrush(MediaColor.FromRgb(133, 134, 151));
        StatusText.Text = status;
    }

    private static string GetDisplayVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;
        return string.IsNullOrWhiteSpace(version) ? "" : version.Split('+')[0];
    }

    internal static Task<int> RunUpdateAsync(bool forceRunAfter) => RunCoreInstallerAsync(string.Empty, false, true, forceRunAfter);

    private static string BuildCoreInstallerArguments(string installPath, bool allUsers, bool isUpdate, bool forceRunAfter)
    {
        if (isUpdate)
        {
            // NSIS launches the app after a silent install only with --force-run.
            return forceRunAfter ? "--updated /S --force-run" : "--updated /S";
        }

        // NSIS parses /D from the rest of the raw command line, so it must
        // be last and unquoted (including paths that contain spaces).
        return $"--{(allUsers ? "allusers" : "currentuser")} /S /D={Path.GetFullPath(installPath)}";
    }

    private static async Task<int> RunCoreInstallerAsync(string installPath, bool allUsers, bool isUpdate, bool forceRunAfter = false)
    {
        var payloadPath = await ExtractCoreInstallerAsync();
        var arguments = BuildCoreInstallerArguments(installPath, allUsers, isUpdate, forceRunAfter);
        var startInfo = new ProcessStartInfo(payloadPath, arguments)
        {
            UseShellExecute = allUsers,
            Verb = allUsers ? "runas" : string.Empty,
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start the installer.");
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    private static async Task<string> ExtractCoreInstallerAsync()
    {
        var payloadDirectory = Path.Combine(Path.GetTempPath(), "zodiak-installer");
        Directory.CreateDirectory(payloadDirectory);
        var payloadPath = Path.Combine(payloadDirectory, "zodiak-core-setup.exe");

        await using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("ZodiakInstaller.CorePayload")
            ?? throw new InvalidOperationException("The embedded installer payload is missing.");
        await using var output = new FileStream(payloadPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await resource.CopyToAsync(output);
        return payloadPath;
    }

    private static void TryLaunchInstalledApp(string installPath)
    {
        var executable = Path.Combine(installPath, "zodiak.exe");
        if (File.Exists(executable))
        {
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        }
    }
}
