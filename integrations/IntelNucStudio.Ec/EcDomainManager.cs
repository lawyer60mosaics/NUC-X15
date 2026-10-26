using System;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace IntelNucStudio.Ec
{
    // Loaded by the .NET Framework runtime from the official EXE's configuration.
    // The official App.Main, Prism startup, MainWindow and vendor modules still run.
    public sealed class EcDomainManager : AppDomainManager
    {
        public override void InitializeNewDomain(AppDomainSetup appDomainInfo)
        {
            base.InitializeNewDomain(appDomainInfo);
            AppDomain.CurrentDomain.UnhandledException += (sender, args) => IntegrationDiagnostics.Write("Unhandled: " + args.ExceptionObject);
            AppDomain.CurrentDomain.ProcessExit += (sender, args) => IntegrationDiagnostics.Write("Official process exited.");
            if (IntegrationDiagnostics.Enabled)
            {
                var exceptionCount = 0;
                AppDomain.CurrentDomain.FirstChanceException += (sender, args) =>
                {
                    if (IntegrationDiagnostics.IsWriting || Interlocked.Increment(ref exceptionCount) > 180) return;
                    var value = args.Exception.ToString();
                    IntegrationDiagnostics.Write("First chance: " + value.Substring(0, Math.Min(value.Length, 1800)));
                };
            }
            IntegrationDiagnostics.Write("Runtime extension loaded; thread=" + Thread.CurrentThread.ManagedThreadId + "; apartment=" + Thread.CurrentThread.GetApartmentState());
            try
            {
                Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(WaitForOfficialShell));
                IntegrationDiagnostics.Write("Waiting for official dispatcher startup.");
            }
            catch (Exception error) { IntegrationDiagnostics.Write("Dispatcher setup failed: " + error); throw; }
        }

        private static void WaitForOfficialShell()
        {
            IntegrationDiagnostics.Write("Official dispatcher is running.");
            var started = DateTime.UtcNow;
            var backgroundPrepared = false;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            EventHandler tick = null;
            tick = (sender, args) =>
            {
                try
                {
                    var app = Application.Current;
                    var window = app?.MainWindow;
                    if (app?.GetType().FullName == "NucSoftwareStudio.App"
                        && window?.GetType().FullName == "NucSoftwareStudio.Views.MainWindow")
                    {
                        // The original `tray` startup returns before Prism shows
                        // the shell. Load its WPF templates invisibly once so our
                        // extension and safe tray exit can attach before first Open.
                        if (!window.IsLoaded && !backgroundPrepared && IsBackgroundStartup(Environment.GetCommandLineArgs()))
                        {
                            backgroundPrepared = true;
                            PrepareBackgroundWindow(window);
                        }
                        if (window.IsLoaded)
                        {
                            timer.Stop();
                            timer.Tick -= tick;
                            EcShellIntegration.Install(app, window);
                        }
                    }
                    if (timer.IsEnabled && DateTime.UtcNow - started > TimeSpan.FromSeconds(60))
                    {
                        timer.Stop();
                        timer.Tick -= tick;
                        IntegrationDiagnostics.Write("Official shell did not become available within 60 seconds.");
                    }
                }
                catch (Exception error)
                {
                    timer.Stop();
                    timer.Tick -= tick;
                    IntegrationDiagnostics.Write("Extension initialization failed: " + error);
                    MessageBox.Show("EC 扩展未能加入官方窗口：" + error.Message,
                        "Intel NUC Software Studio · EC 扩展", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            };
            timer.Tick += tick;
            timer.Start();
        }

        internal static bool IsBackgroundStartup(string[] arguments) => arguments.Length > 1 && arguments[1] == "tray";

        internal static void PrepareBackgroundWindow(Window window)
        {
            var opacity = window.Opacity;
            var taskbar = window.ShowInTaskbar;
            try
            {
                window.Opacity = 0;
                window.ShowInTaskbar = false;
                window.Show();
                window.UpdateLayout();
            }
            finally
            {
                window.Hide();
                window.ShowInTaskbar = taskbar;
                window.Opacity = opacity;
            }
        }
    }

    internal static class IntegrationDiagnostics
    {
        [ThreadStatic] private static bool _writing;
        public static bool IsWriting => _writing;
        private static string DiagnosticPath
        {
            get
            {
                var path = Environment.GetEnvironmentVariable("NSS_EC_DIAGNOSTICS");
                if (!string.IsNullOrWhiteSpace(path)) return path;
                var marker = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".ec-diagnostics");
                try { return File.Exists(marker) ? File.ReadAllText(marker).Trim() : null; } catch { return null; }
            }
        }
        public static bool Enabled => !string.IsNullOrWhiteSpace(DiagnosticPath);
        public static void Write(string message)
        {
            if (_writing) return;
            _writing = true;
            try
            {
                var path = DiagnosticPath;
                if (!string.IsNullOrWhiteSpace(path))
                    File.AppendAllText(path, DateTime.UtcNow.ToString("O") + " " + message + Environment.NewLine);
            }
            catch { /* Optional development diagnostics must never stop the official app. */ }
            finally { _writing = false; }
        }
    }
}
