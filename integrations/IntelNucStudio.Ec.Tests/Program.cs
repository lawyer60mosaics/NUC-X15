using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using IntelNucStudio.Ec;
using NssWpfHost.Ec;

// A real WPF dispatcher and controls, with a fake EC boundary. No WMI or vendor
// service is accessed. The stub view names exercise the official navigation selector.
namespace FeatureMgr.Views
{
    public sealed class ProfilesView : UserControl { }
    public sealed class DetailView : UserControl { }
}

namespace MobilePerformanceMgr.Views
{
    public sealed class MobilePerformanceSummaryView : UserControl { }
    public sealed class MobilePerformanceView : UserControl { }
}

namespace SystemMonitorMgr.Views
{
    public sealed class SystemMonitorButtonView : UserControl { }
}

namespace IntelNucStudio.Ec.Tests
{
    internal static class Program
    {
        private static int _passed;
        private static int _result = 1;
        private static FakeController _controller;
        private static bool _exitViaTray;
        private static string _officialDirectory;

        [STAThread]
        private static int Main(string[] args)
        {
            _exitViaTray = Array.IndexOf(args, "--exit-via-tray") >= 0;
            var directoryIndex = Array.IndexOf(args, "--official-dir");
            if (directoryIndex >= 0 && directoryIndex + 1 < args.Length) _officialDirectory = args[directoryIndex + 1];
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.Startup += async (sender, args) =>
            {
                try { await RunScenarios(app); }
                catch (Exception error) { Console.Error.WriteLine(error); app.Shutdown(1); }
            };
            var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
            timeout.Tick += (sender, args) => { Console.Error.WriteLine("WPF test timed out"); app.Shutdown(2); };
            timeout.Start();
            app.Run();
            timeout.Stop();
            if (_result == 0 && _controller?.IsManualControlRequested == true) return 3;
            Console.WriteLine(_passed + " WPF integration scenarios passed; no hardware accessed.");
            return _result;
        }

        private static async Task RunScenarios(Application app)
        {
            await EcPresetScenarios.RunAsync(Pass);
            TrayScenarios.Run(Pass, _officialDirectory);
            var performance = new MobilePerformanceMgr.Views.MobilePerformanceSummaryView { Content = new Button { Content = "Performance setting" } };
            var keyboard = new Button { Content = "Keyboard setting" };
            var cards = new Grid();
            cards.ColumnDefinitions.Add(new ColumnDefinition());
            cards.ColumnDefinitions.Add(new ColumnDefinition());
            cards.Children.Add(performance);
            Grid.SetColumn(keyboard, 1);
            cards.Children.Add(keyboard);
            var monitorContent = new StackPanel();
            monitorContent.Children.Add(new Image { Width = 36, Height = 36 });
            monitorContent.Children.Add(new TextBlock { Text = "系统监视器", FontSize = 12 });
            var monitor = new SystemMonitorMgr.Views.SystemMonitorButtonView
            {
                Width = 100, Height = 70, HorizontalAlignment = HorizontalAlignment.Left,
                Content = new Button { Content = monitorContent }
            };
            var homeLayout = new Grid();
            homeLayout.RowDefinitions.Add(new RowDefinition());
            homeLayout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(80) });
            homeLayout.Children.Add(cards);
            Grid.SetRow(monitor, 1);
            homeLayout.Children.Add(monitor);
            var home = new FeatureMgr.Views.ProfilesView { Content = homeLayout };
            var officialRegion = new ContentControl { Content = home };
            var close = new Button { Content = new TextBlock { Text = "\uE106" } };
            var root = new Grid();
            root.Children.Add(officialRegion);
            root.Children.Add(close);
            var flags = new ShellFlags();
            var window = new Window { Content = root, DataContext = flags, Width = 1000, Height = 700,
                Left = -15000, Top = -15000, Opacity = 0, ShowInTaskbar = false };
            app.MainWindow = window;
            window.Show();
            await Pump();
            Exception releaseError = null;
            var integration = new EcShellIntegration(app, window,
                () => new EcControlPage(_controller = new FakeController(), () => { }), error => releaseError = error);
            await Pump();
            var entry = Find<Button>(root, value => value.Name == "NssEcModuleEntry");
            Assert(entry.Visibility == Visibility.Visible, "Entry should be visible on the home view");
            Assert(ReferenceEquals(window.Content, root), "Integration must not reparent official Window.Content");
            Pass("Home-only entry preserves the official visual tree");
            var entryIcon = Find<Image>(entry, value => true);
            var entryLabel = Find<TextBlock>(entry, value => value.Text == "EC 风扇控制");
            Assert(entry.BorderThickness == new Thickness(0) && entryIcon.Width == 36 && entryIcon.Height == 36
                && entryLabel.FontSize == 12 && entry.Margin.Left > monitor.ActualWidth,
                "EC shortcut must match the icon/caption monitor style beside the original shortcut");
            Pass("EC shortcut matches the system monitor icon/caption style without a frame");

            officialRegion.Content = new FeatureMgr.Views.DetailView();
            await Pump();
            Assert(entry.Visibility == Visibility.Collapsed, "Entry leaked into a detail view");
            officialRegion.Content = home;
            flags.SettingsVisible = true;
            await Pump();
            Assert(entry.Visibility == Visibility.Collapsed, "Entry leaked into settings");
            flags.SettingsVisible = false;
            window.InvalidateMeasure();
            await Pump();
            Assert(entry.Visibility == Visibility.Visible, "Entry did not return on home");
            Pass("Detail/settings navigation hides the EC entry");

            Click(entry);
            await Pump();
            var page = Find<EcControlPage>(root, value => true);
            foreach (var preset in new[] { EcFanPreset.Quiet, EcFanPreset.Performance, EcFanPreset.Balanced })
            {
                Click(Find<Button>(page, value => Equals(value.Tag, preset.ToString())));
                await Pump();
                Assert(_controller.ActivePreset == preset && _controller.IsCurveControlRunning,
                    "Preset button did not select " + preset);
                Assert(Find<TextBlock>(page, value => value.Name == "ControlState").Text.Contains(EcFanPresets.Get(preset).Name),
                    "Current preset status is incorrect");
            }
            Assert(_controller.StartCalls == 3 && _controller.ReleaseCalls == 0, "Preset switching must not release EC");
            Pass("Three preset buttons switch curves without releasing EC");
            _controller.FailPreset = EcFanPreset.Quiet;
            Click(Find<Button>(page, value => Equals(value.Tag, "Quiet")));
            await Pump();
            Assert(_controller.ActivePreset == EcFanPreset.Balanced && !performance.IsEnabled && keyboard.IsEnabled,
                "Failed preset switching must retain the previous preset and lock");
            _controller.FailPreset = null;
            Pass("Failed preset switching retains the active curve and official lock");
            _controller.IsManualControlRequested = true;
            Click(Find<Button>(page, value => Equals(value.Content, "重新读取")));
            await Pump();
            var mask = Find<Border>(root, value => value.Name == "NssEcControlMask");
            Assert(mask.Visibility == Visibility.Visible && !performance.IsEnabled && officialRegion.IsEnabled && keyboard.IsEnabled,
                "EC must lock only performance and leave other settings usable");
            Assert(Math.Abs(mask.Width - performance.ActualWidth) < 1 && mask.Width < root.ActualWidth,
                "Mask should match performance card bounds, not the whole window");
            var warning = Find<TextBlock>(mask, value => value.Text == "EC控制中");
            Assert(((SolidColorBrush)warning.Foreground).Color.R > 200, "Warning should be red");
            Pass("Active EC masks only performance and keeps keyboard controls usable");

            Click(Find<Button>(root, value => Equals(value.Content, "‹  返回官方主页")));
            await Pump();
            Assert(_controller.IsManualControlRequested && mask.Visibility == Visibility.Visible && !performance.IsEnabled && keyboard.IsEnabled,
                "Returning home must retain EC and its interlock");
            Assert(entry.Visibility == Visibility.Visible, "Home entry must remain accessible beside a performance-only mask");
            Pass("Returning home keeps EC running behind the mask");

            var lightControl = new Button { Content = "Light setting" };
            officialRegion.Content = new FeatureMgr.Views.DetailView { Content = lightControl };
            await Pump();
            Assert(mask.Visibility == Visibility.Collapsed && lightControl.IsEnabled && _controller.IsManualControlRequested,
                "Non-performance detail pages must stay unmasked during EC control");
            var performanceDetail = new MobilePerformanceMgr.Views.MobilePerformanceView { Content = new Button { Content = "Fan mode" } };
            officialRegion.Content = new FeatureMgr.Views.DetailView { Content = performanceDetail };
            await Pump();
            Assert(mask.Visibility == Visibility.Visible && !performanceDetail.IsEnabled && officialRegion.IsEnabled,
                "Performance detail must be locked without disabling the whole shell");
            officialRegion.Content = home;
            await Pump();
            Pass("Navigation masks performance detail while leaving lighting detail usable");

            _controller.FailRelease = true;
            Click(Find<Button>(mask, value => Equals(value.Content, "停止 EC 并解锁")));
            await Pump();
            Assert(releaseError != null && mask.Visibility == Visibility.Visible && !performance.IsEnabled && keyboard.IsEnabled,
                "Failed handoff must keep official settings locked");
            Pass("Failed handoff retains the mask and lock");

            _controller.FailRelease = false;
            Click(Find<Button>(mask, value => Equals(value.Content, "停止 EC 并解锁")));
            await Pump();
            Assert(!_controller.IsManualControlRequested && _controller.Disposed && officialRegion.IsEnabled
                && performance.IsEnabled && performanceDetail.IsEnabled && mask.Visibility == Visibility.Collapsed,
                "Successful handoff did not restore all performance views");
            Pass("Successful handoff restores official settings");

            Click(entry);
            await Pump();
            page = Find<EcControlPage>(root, value => true);
            _controller.IsManualControlRequested = true;
            Click(Find<Button>(page, value => Equals(value.Content, "重新读取")));
            await Pump();
            _controller.FailRelease = true;
            using (var failedExitTray = new TestOfficialTray())
            using (var failedExitBridge = new OfficialTrayBridge(failedExitTray, failedExitTray.Icon, integration.ExitApplicationAsync))
                failedExitTray.ExitItem.PerformClick();
            await Pump();
            Assert(!window.Dispatcher.HasShutdownStarted && _controller.IsManualControlRequested
                && !performance.IsEnabled && keyboard.IsEnabled, "Failed tray exit must retain EC and the performance-only lock");
            _controller.FailRelease = false;
            Pass("Failed EC handoff during tray exit leaves the application running for retry");
            _result = 0;
            if (_exitViaTray)
            {
                using (var tray = new TestOfficialTray())
                using (var bridge = new OfficialTrayBridge(tray, tray.Icon, integration.ExitApplicationAsync))
                    tray.ExitItem.PerformClick();
            }
            else close.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                { RoutedEvent = UIElement.PreviewMouseLeftButtonDownEvent });
            Assert(!_controller.IsManualControlRequested && _controller.Disposed, "Close button must hand off EC before shutdown");
            Pass((_exitViaTray ? "Official tray exit" : "Official close button") + " hands off EC before process exit");
        }

        private static async Task Pump() { await Dispatcher.Yield(DispatcherPriority.ApplicationIdle); }
        private static void Click(Button button) { button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static void Pass(string message) { _passed++; Console.WriteLine("PASS " + message); }
        private static T Find<T>(DependencyObject node, Predicate<T> matches) where T : DependencyObject
        {
            var result = TryFind(node, matches);
            return result ?? throw new Exception("Missing control: " + typeof(T).Name);
        }
        private static T TryFind<T>(DependencyObject node, Predicate<T> matches) where T : DependencyObject
        {
            if (node is T value && matches(value)) return value;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = TryFind(VisualTreeHelper.GetChild(node, i), matches);
                if (found != null) return found;
            }
            return null;
        }
    }

    public sealed class ShellFlags { public bool ShowEula { get; set; } public bool SettingsVisible { get; set; } }

    internal sealed class FakeController : IEcFanController
    {
        public bool IsCurveControlRunning { get; private set; }
        public bool IsManualControlRequested { get; set; }
        public EcFanPreset? ActivePreset { get; private set; }
        public EcFanPreset? FailPreset;
        public int StartCalls;
        public int ReleaseCalls;
        public bool FailRelease;
        public bool Disposed;
        public Task<EcFanSnapshot> ReadSnapshotAsync() => Task.FromResult(new EcFanSnapshot
            { Model = "TEST-NO-HARDWARE", CpuTemperatureC = 50, GpuTemperatureC = 45, LeftFanRpm = 1800, RightFanRpm = 1600 });
        public Task SetManualControlAsync() { IsManualControlRequested = true; return Task.CompletedTask; }
        public Task StartCurveControlAsync(EcFanPreset preset, Action<string> status, Action<EcFanSnapshot> snapshot)
        {
            if (preset == FailPreset) return Task.FromException(new InvalidOperationException("Simulated preset failure"));
            StartCalls++;
            ActivePreset = preset;
            IsManualControlRequested = IsCurveControlRunning = true;
            return Task.CompletedTask;
        }
        public Task StopCurveControlAsync() => ReleaseManualControlOnExitAsync();
        public Task<bool> SetFanPercentAsync(int left, int right) => Task.FromResult(false);
        public Task ReleaseManualControlOnExitAsync()
        {
            ReleaseCalls++;
            if (FailRelease) return Task.FromException(new InvalidOperationException("Simulated handoff failure"));
            IsManualControlRequested = IsCurveControlRunning = false;
            ActivePreset = null;
            return Task.CompletedTask;
        }
        public void Dispose() { Disposed = true; }
    }
}
