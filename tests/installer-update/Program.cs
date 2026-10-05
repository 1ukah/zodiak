using System.Reflection;
using System.IO;

var buildArguments = typeof(ZodiakInstaller.MainWindow).GetMethod("BuildCoreInstallerArguments", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new InvalidOperationException("Core installer command builder was not found.");

string Arguments(string path, bool allUsers, bool update, bool runAfter) =>
    (string)buildArguments.Invoke(null, new object[] { path, allUsers, update, runAfter })!;

void Check(bool condition, string label)
{
    if (!condition) throw new InvalidOperationException(label);
    Console.WriteLine($"PASS {label}");
}

var restartUpdate = Arguments(string.Empty, false, true, true).Split(' ');
Check(restartUpdate.Contains("--updated") && restartUpdate.Contains("/S") && restartUpdate.Contains("--force-run"),
    "Restart update forwards silent mode and NSIS relaunch flag");
Check(!restartUpdate.Any(argument => argument.StartsWith("/D=")),
    "Update lets NSIS recover the existing installation directory");
Check(!Arguments(string.Empty, false, true, false).Contains("--force-run"),
    "Update without a relaunch request does not start the app");

var customPath = Path.Combine(Path.GetTempPath(), "Zodiak Installer Tests", "custom installation");
var manualInstall = Arguments(customPath, false, false, true);
Check(manualInstall.StartsWith("--currentuser /S ") && manualInstall.EndsWith($"/D={customPath}"),
    "Manual installation retains the selected path with spaces and puts /D last");
Check(!manualInstall.Contains("--force-run"),
    "Manual installation leaves launching to the custom installer UI");
Check(Arguments(customPath, true, false, false).StartsWith("--allusers /S "),
    "Manual all-users installation retains its scope");

// Exercise the actual WPF view with a controlled installer process result.
// Never run NSIS or change the machine's installed app during these tests.
Exception? uiFailure = null;
var uiThread = new Thread(() =>
{
    try
    {
        var application = new System.Windows.Application { ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown };
        var output = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../release/update-review"));
        Directory.CreateDirectory(output);
        var type = typeof(ZodiakInstaller.UpdateWindow);
        ZodiakInstaller.UpdateWindow View(Func<bool, Action<string>, Task<int>> runner) =>
            (ZodiakInstaller.UpdateWindow)Activator.CreateInstance(type, BindingFlags.Instance | BindingFlags.NonPublic,
                null, new object[] { true, runner }, null)!;
        Task Install(ZodiakInstaller.UpdateWindow view)
        {
            type.GetField("started", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(view, true);
            return (Task)type.GetMethod("InstallAsync", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(view, null)!;
        }
        void Render(ZodiakInstaller.UpdateWindow view, string name)
        {
            // Give WPF a presentation source so the activity animation runs.
            // Keep the test window offscreen and out of the user's taskbar.
            view.WindowStartupLocation = System.Windows.WindowStartupLocation.Manual;
            view.Left = -10000;
            view.Top = -10000;
            view.ShowActivated = false;
            view.ShowInTaskbar = false;
            view.Show();
            var content = (System.Windows.FrameworkElement)view.Content;
            content.Measure(new System.Windows.Size(480, 240));
            content.Arrange(new System.Windows.Rect(0, 0, 480, 240));
            content.UpdateLayout();
            var frame = new System.Windows.Threading.DispatcherFrame();
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
            timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; };
            timer.Start();
            System.Windows.Threading.Dispatcher.PushFrame(frame);
            if (name == "06-installing")
            {
                var progress = (System.Windows.Controls.ProgressBar)view.FindName("InstallProgress");
                var indicator = (System.Windows.Controls.Border)progress.Template.FindName("ActivityIndicator", progress);
                var offset = (System.Windows.Media.TranslateTransform)indicator.RenderTransform;
                Check(indicator.ActualWidth < progress.ActualWidth && offset.X > -86,
                    "Installation shows a moving activity segment rather than a completed percentage");
            }
            var bitmap = new System.Windows.Media.Imaging.RenderTargetBitmap(480, 240, 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
            bitmap.Render(content);
            var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
            encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bitmap));
            using var file = File.Create(Path.Combine(output, name + ".png"));
            encoder.Save(file);
        }
        var completion = new TaskCompletionSource<int>();
        bool requestedRelaunch = false;
        var updating = View((runAfter, status) => { requestedRelaunch = runAfter; status("Updating…"); return completion.Task; });
        var running = Install(updating);
        Check(requestedRelaunch && !running.IsCompleted, "Update view remains active while the installer works and preserves relaunch request");
        var closing = new System.ComponentModel.CancelEventArgs();
        type.GetMethod("Window_Closing", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(updating, new object?[] { updating, closing });
        Check(closing.Cancel, "Closing cannot interrupt an active installation");
        Render(updating, "06-installing");
        completion.SetResult(0);
        running.GetAwaiter().GetResult();
        Check(updating.ExitCode == 0, "Successful installer completion closes the update view");

        var attempts = 0;
        var failed = View((_, _) => { attempts++; return Task.FromResult(7); });
        Install(failed).GetAwaiter().GetResult();
        Check(failed.ExitCode != 0 && ((System.Windows.Controls.TextBlock)failed.FindName("StatusText")).Text == "Could not update" &&
            ((System.Windows.Controls.ProgressBar)failed.FindName("InstallProgress")).Visibility == System.Windows.Visibility.Collapsed &&
            ((System.Windows.Controls.Button)failed.FindName("CloseButton")).Visibility == System.Windows.Visibility.Visible,
            "Installer failure remains visible with a close control and no false progress");
        Render(failed, "07-install-error");
        Install(failed).GetAwaiter().GetResult();
        Check(attempts == 2, "Failed installation can be retried from the same view");
        failed.Close();
        var thrown = View((_, _) => throw new IOException("Cannot extract installer"));
        Install(thrown).GetAwaiter().GetResult();
        Check(((System.Windows.Controls.TextBlock)thrown.FindName("ErrorText")).Visibility == System.Windows.Visibility.Visible,
            "Extraction/process-start exceptions are shown in the custom update view");
        thrown.Close();
        application.Shutdown();
        Console.WriteLine("Installer previews: " + output);
    }
    catch (Exception exception) { uiFailure = exception; }
});
uiThread.SetApartmentState(ApartmentState.STA);
uiThread.Start();
uiThread.Join();
if (uiFailure is not null) throw new InvalidOperationException("Installer UI checks failed", uiFailure);
