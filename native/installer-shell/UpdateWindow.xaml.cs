using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Input;

namespace ZodiakInstaller;

public partial class UpdateWindow : Window
{
    private readonly bool forceRunAfter;
    private readonly Func<bool, Action<string>, Task<int>> runUpdate;
    private bool running;
    private bool started;
    public int ExitCode { get; private set; } = 1;

    public UpdateWindow(bool forceRunAfter) : this(forceRunAfter,
        (runAfter, onStatus) => ZodiakInstaller.MainWindow.RunUpdateAsync(runAfter, onStatus)) { }

    internal UpdateWindow(bool forceRunAfter, Func<bool, Action<string>, Task<int>> runUpdate)
    {
        InitializeComponent();
        this.forceRunAfter = forceRunAfter;
        this.runUpdate = runUpdate;
        VersionText.Text = $"v{ZodiakInstaller.MainWindow.GetDisplayVersion()}";
    }

    private async void Window_ContentRendered(object? sender, EventArgs e)
    {
        if (started) return;
        started = true;
        await InstallAsync();
    }

    private async Task InstallAsync()
    {
        if (running) return;
        running = true;
        InstallProgress.Visibility = Visibility.Visible;
        ErrorText.Visibility = ErrorActions.Visibility = CloseButton.Visibility = Visibility.Collapsed;
        try
        {
            ExitCode = await runUpdate(forceRunAfter, status => StatusText.Text = status);
            if (ExitCode != 0) throw new InvalidOperationException($"Update installer exited with code {ExitCode}.");
            running = false;
            Close();
        }
        catch (Exception exception)
        {
            Debug.WriteLine(exception);
            ExitCode = 1;
            running = false;
            StatusText.Text = "Could not update";
            InstallProgress.Visibility = Visibility.Collapsed;
            ErrorText.Visibility = ErrorActions.Visibility = CloseButton.Visibility = Visibility.Visible;
            RetryButton.Focus();
        }
    }

    private async void Retry_Click(object sender, RoutedEventArgs e) => await InstallAsync();
    private void Close_Click(object sender, RoutedEventArgs e) { if (!running) Close(); }
    private void Window_Closing(object? sender, CancelEventArgs e) { e.Cancel = running; }
    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton == MouseButtonState.Pressed) DragMove();
    }
}
