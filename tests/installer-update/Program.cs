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
