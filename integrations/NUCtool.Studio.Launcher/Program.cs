using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Windows.Forms;
using IntelNucStudio.Ec;

namespace NUCtool.Studio.Launcher
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            var maintenance = args.Length > 0 && args[0].StartsWith("--", StringComparison.Ordinal);
            try
            {
                if (args.Length == 1 && args[0] == "--check-running")
                {
                    var processes = Process.GetProcessesByName("NucSoftwareStudio");
                    foreach (var process in processes) process.Dispose();
                    return processes.Length > 0 ? 20 : 0;
                }
                if (args.Length == 2 && args[0] == "--validate-directory")
                    return InstallationTasks.IsInstallDirectoryAllowed(args[1]) ? 0 : 21;
                if ((args.Length == 2 || args.Length == 3) && args[0] == "--update-startup")
                {
                    if (!InstallationTasks.HasInstallationMarker(args[1])) return 22;
                    InstallationTasks.Migrate(args[1], args.Length == 3 ? args[2] : null,
                        WindowsIdentity.GetCurrent().User.Value, new WindowsLogonTaskStore());
                    return 0;
                }
                if (args.Length == 2 && args[0] == "--remove-startup")
                {
                    if (!InstallationTasks.HasInstallationMarker(args[1])) return 22;
                    InstallationTasks.Remove(args[1], new WindowsLogonTaskStore());
                    return 0;
                }
                if (args.Length != 0) return 2;
                var directory = AppDomain.CurrentDomain.BaseDirectory;
                var exe = Path.Combine(directory, "NucSoftwareStudio.exe");
                if (!File.Exists(exe)) throw new FileNotFoundException("程序文件不完整，请重新安装。", exe);
                using (Process.Start(new ProcessStartInfo { FileName = exe, WorkingDirectory = directory, UseShellExecute = false })) { }
                return 0;
            }
            catch (Exception error)
            {
                if (!maintenance) MessageBox.Show(error.Message, "NUCtool Studio EC", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
