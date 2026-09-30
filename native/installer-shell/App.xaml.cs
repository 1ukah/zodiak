namespace ZodiakInstaller;

public partial class App : System.Windows.Application
{
    protected override async void OnStartup(System.Windows.StartupEventArgs e)
    {
        base.OnStartup(e);

        // electron-updater starts the published setup executable with this
        // switch. Keep that update path non-interactive while the visible
        // installer remains entirely custom for a person installing manually.
        if (e.Args.Contains("--updated", StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var exitCode = await ZodiakInstaller.MainWindow.RunUpdateAsync();
                Shutdown(exitCode);
            }
            catch
            {
                Shutdown(1);
            }
            return;
        }

        new MainWindow().Show();
    }
}
