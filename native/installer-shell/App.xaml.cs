namespace ZodiakInstaller;

public partial class App : System.Windows.Application
{
    protected override void OnStartup(System.Windows.StartupEventArgs e)
    {
        base.OnStartup(e);

        // This independent window survives the Electron app closing for update.
        // The embedded NSIS remains silent; all visible feedback belongs to us.
        if (e.Args.Contains("--updated", StringComparer.OrdinalIgnoreCase))
        {
            ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown;
            var forceRunAfter = e.Args.Contains("--force-run", StringComparer.OrdinalIgnoreCase);
            var window = new UpdateWindow(forceRunAfter);
            MainWindow = window;
            window.Closed += (_, _) => Shutdown(window.ExitCode);
            window.Show();
            return;
        }

        new MainWindow().Show();
    }
}
