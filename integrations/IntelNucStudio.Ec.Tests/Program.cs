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

namespace IntelNucStudio.Ec.Tests
{
    internal static class Program
    {
        private static int _passed;
        private static int _result = 1;
        private static FakeController _controller;

        [STAThread]
        private static int Main()
        {
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
            var home = new FeatureMgr.Views.ProfilesView { Content = new Button { Content = "Official setting" } };
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
            new EcShellIntegration(app, window,
                () => new EcControlPage(_controller = new FakeController(), () => { }), error => releaseError = error);
            await Pump();
            var entry = Find<Button>(root, value => value.Name == "NssEcModuleEntry");
            Assert(entry.Visibility == Visibility.Visible, "Entry should be visible on the home view");
            Assert(ReferenceEquals(window.Content, root), "Integration must not reparent official Window.Content");
            Pass("Home-only entry preserves the official visual tree");

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
            Assert(_controller.ActivePreset == EcFanPreset.Balanced && !officialRegion.IsEnabled,
                "Failed preset switching must retain the previous preset and lock");
            _controller.FailPreset = null;
            Pass("Failed preset switching retains the active curve and official lock");
            _controller.IsManualControlRequested = true;
            Click(Find<Button>(page, value => Equals(value.Content, "重新读取")));
            await Pump();
            var mask = Find<Border>(root, value => value.Name == "NssEcControlMask");
            Assert(mask.Visibility == Visibility.Visible && !officialRegion.IsEnabled, "EC did not lock official controls");
            var warning = Find<TextBlock>(mask, value => value.Text == "EC控制中");
            Assert(((SolidColorBrush)warning.Foreground).Color.R > 200, "Warning should be red");
            Pass("Active EC displays a red warning and disables official settings");

            Click(Find<Button>(root, value => Equals(value.Content, "‹  返回官方主页")));
            await Pump();
            Assert(_controller.IsManualControlRequested && mask.Visibility == Visibility.Visible && !officialRegion.IsEnabled,
                "Returning home must retain EC and its interlock");
            Assert(entry.Visibility == Visibility.Collapsed, "Normal entry should be hidden under the EC mask");
            Pass("Returning home keeps EC running behind the mask");

            _controller.FailRelease = true;
            Click(Find<Button>(mask, value => Equals(value.Content, "停止 EC 并解锁")));
            await Pump();
            Assert(releaseError != null && mask.Visibility == Visibility.Visible && !officialRegion.IsEnabled,
                "Failed handoff must keep official settings locked");
            Pass("Failed handoff retains the mask and lock");

            _controller.FailRelease = false;
            Click(Find<Button>(mask, value => Equals(value.Content, "停止 EC 并解锁")));
            await Pump();
            Assert(!_controller.IsManualControlRequested && _controller.Disposed && officialRegion.IsEnabled
                && mask.Visibility == Visibility.Collapsed, "Successful handoff did not unlock official controls");
            Pass("Successful handoff restores official settings");

            Click(entry);
            await Pump();
            page = Find<EcControlPage>(root, value => true);
            _controller.IsManualControlRequested = true;
            Click(Find<Button>(page, value => Equals(value.Content, "重新读取")));
            await Pump();
            _result = 0;
            close.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                { RoutedEvent = UIElement.PreviewMouseLeftButtonDownEvent });
            Assert(!_controller.IsManualControlRequested && _controller.Disposed, "Close button must hand off EC before shutdown");
            Pass("Official close button hands off EC before process exit");
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
