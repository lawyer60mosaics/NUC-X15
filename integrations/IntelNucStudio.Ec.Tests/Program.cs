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
        private static string _snapshotDirectory;

        [STAThread]
        private static int Main(string[] args)
        {
            _exitViaTray = Array.IndexOf(args, "--exit-via-tray") >= 0;
            var directoryIndex = Array.IndexOf(args, "--official-dir");
            if (directoryIndex >= 0 && directoryIndex + 1 < args.Length) _officialDirectory = args[directoryIndex + 1];
            var snapshotIndex = Array.IndexOf(args, "--snapshot-dir");
            if (snapshotIndex >= 0 && snapshotIndex + 1 < args.Length) _snapshotDirectory = args[snapshotIndex + 1];
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var inspectIndex = Array.IndexOf(args, "--inspect-theme");
            if (inspectIndex >= 0)
            {
                using (var fixture = new OfficialThemeFixture(_officialDirectory)) fixture.Inspect(app, args[inspectIndex + 1]);
                return 0;
            }
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
            InstallationScenarios.Run(Pass);
            await AutoStartScenarios.RunAsync(Pass, Array.IndexOf(Environment.GetCommandLineArgs(), "--task-scheduler-check") >= 0);
            TrayScenarios.Run(Pass, _officialDirectory);
            await LicenseConsentScenarios.Run(Pass);
            await IndustrialThemeScenarios.Run(app, _officialDirectory, _snapshotDirectory, Pass);
            var performance = new MobilePerformanceMgr.Views.MobilePerformanceSummaryView { Content = new Button { Content = "Performance setting" } };
            var keyboard = new Button { Content = "Keyboard setting" };
            var cards = new Grid();
            cards.ColumnDefinitions.Add(new ColumnDefinition());
            cards.ColumnDefinitions.Add(new ColumnDefinition());
            cards.Children.Add(performance);
            Grid.SetColumn(keyboard, 1);
            cards.Children.Add(keyboard);
            var monitorContent = new StackPanel();
            monitorContent.Children.Add(new Image { Width = 36, Height = 36,
                Source = new DrawingImage(new GeometryDrawing(Brushes.DeepSkyBlue, null, new RectangleGeometry(new Rect(0, 0, 36, 36)))) });
            monitorContent.Children.Add(new TextBlock { Text = "系统监视器", FontSize = 12 });
            var monitor = new SystemMonitorMgr.Views.SystemMonitorButtonView
            {
                Width = 100, Height = 70, HorizontalAlignment = HorizontalAlignment.Left,
                Content = new Button { Content = monitorContent }
            };
            var homeLayout = new Grid();
            homeLayout.RowDefinitions.Add(new RowDefinition());
            homeLayout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            homeLayout.Children.Add(cards);
            var footer = new Grid();
            footer.ColumnDefinitions.Add(new ColumnDefinition());
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var nativeButtons = new ItemsControl { Name = "ButtonContent" };
            nativeButtons.Items.Add(monitor);
            footer.Children.Add(nativeButtons);
            Grid.SetRow(footer, 1);
            homeLayout.Children.Add(footer);
            var home = new FeatureMgr.Views.ProfilesView { Content = homeLayout };
            var officialRegion = new ContentControl { Content = home };
            var close = new Button { Content = new TextBlock { Text = "\uE106" } };
            var root = new Grid();
            root.Children.Add(officialRegion);
            root.Children.Add(close);
            var flags = new ShellFlags();
            var window = new TestOfficialWindow(close) { Content = root, DataContext = flags, Width = 1000, Height = 700,
                Left = -15000, Top = -15000, Opacity = 0, ShowInTaskbar = false };
            app.MainWindow = window;
            window.Show();
            await Pump();
            Exception releaseError = null;
            var integration = new EcShellIntegration(app, window,
                () => new EcControlPage(_controller = new FakeController(), () => { }), error => releaseError = error);
            await Pump();
            var entry = Find<Button>(root, value => value.Name == "NssEcModuleEntry");
            var startup = Find<AutoStartControl>(root, value => true);
            Assert(startup.Visibility == Visibility.Visible, "Startup control must be directly discoverable on home");
            Assert(entry.Visibility == Visibility.Visible, "Entry should be visible on the home view");
            Assert(ReferenceEquals(window.Content, root), "Integration must not reparent official Window.Content");
            Pass("Home-only entry preserves the official visual tree");
            var entryIcon = Find<Image>(entry, value => true);
            var entryLabel = Find<TextBlock>(entry, value => value.Text == "EC 风扇控制");
            Assert(entry.BorderThickness == new Thickness(0) && entryIcon.Width == 36 && entryIcon.Height == 36
                && entryLabel.FontSize == 14 && ReferenceEquals(entry.Parent, footer),
                "EC shortcut must match the icon/caption monitor style beside the original shortcut");
            Pass("EC shortcut matches the system monitor icon/caption style without a frame");
            Assert(((SolidColorBrush)entryLabel.Foreground).Color == Color.FromRgb(0, 175, 229),
                "EC caption must keep the official cyan rather than inherit an unreadable default foreground");
            await VerifyResponsiveEntry(window, root, monitor, entry, entryIcon, entryLabel);
            CloseWithMouse(close);
            await Pump();
            Assert(!window.IsVisible && !window.Dispatcher.HasShutdownStarted,
                "Titlebar X must hide the window instead of exiting");
            window.Show();
            await Pump();
            Assert(entry.Visibility == Visibility.Visible, "Restoring from tray must restore the home shortcut");
            Click(close);
            await Pump();
            Assert(!window.IsVisible && window.OriginalCloseCalls == 0 && !window.Dispatcher.HasShutdownStarted,
                "Accessibility Click must hide and bypass the original package-dependent callback");
            window.Show();
            await Pump();
            Pass("Titlebar X hides the idle window and permits restoring it");

            officialRegion.Content = new FeatureMgr.Views.DetailView();
            await Pump();
            Assert(entry.Visibility == Visibility.Collapsed, "Entry leaked into a detail view");
            Assert(startup.Visibility == Visibility.Collapsed, "Startup footer must not overlap detail views");
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
            foreach (UIElement child in root.Children)
                Assert(!(child is FrameworkElement frame) || frame.Name != "NssIndustrialCardFrames",
                    "Shell-wide drawing overlays must not cover native dialogs");
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
            var releaseCallsBeforeHide = _controller.ReleaseCalls;
            CloseWithMouse(close);
            await Pump();
            Assert(!window.IsVisible && !window.Dispatcher.HasShutdownStarted && _controller.IsCurveControlRunning
                && _controller.ReleaseCalls == releaseCallsBeforeHide && !_controller.Disposed,
                "Titlebar X must leave the active EC controller running in the background");
            window.Show();
            await Pump();
            Assert(ReferenceEquals(page, Find<EcControlPage>(root, value => true)) && !performance.IsEnabled && keyboard.IsEnabled,
                "Restoring the window must retain the EC page and performance-only lock");
            foreach (var key in new[] { Key.Return, Key.Space })
            {
                close.RaiseEvent(new KeyEventArgs(Keyboard.PrimaryDevice, PresentationSource.FromVisual(window), 0, key)
                    { RoutedEvent = UIElement.PreviewKeyDownEvent });
                await Pump();
                Assert(!window.IsVisible && _controller.ReleaseCalls == releaseCallsBeforeHide,
                    "Keyboard activation of titlebar X must hide without releasing EC");
                window.Show();
                await Pump();
            }
            var altF4 = new KeyEventArgs(Keyboard.PrimaryDevice, PresentationSource.FromVisual(window), 0, Key.F4);
            typeof(KeyEventArgs).GetMethod("MarkSystem", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(altF4, null);
            altF4.RoutedEvent = UIElement.PreviewKeyDownEvent;
            window.RaiseEvent(altF4);
            await Pump();
            Assert(!window.IsVisible && _controller.IsCurveControlRunning && _controller.ReleaseCalls == releaseCallsBeforeHide,
                "Alt+F4 must hide without releasing EC");
            window.Show();
            await Pump();
            window.Close();
            await Pump();
            Assert(!window.IsVisible && _controller.IsCurveControlRunning && !window.Dispatcher.HasShutdownStarted,
                "System close must hide without exiting or stopping EC");
            window.Show();
            await Pump();
            Pass("Mouse, keyboard, Alt+F4 and system close preserve EC while hidden and after restoring");
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
            Assert(mask.Child is StackPanel, "Performance lock text must wrap instead of shrinking inside a Viewbox");
            window.Width = 640;
            await Pump();
            foreach (var caption in new[] { "返回 EC 控制", "停止 EC 并解锁" })
            {
                var action = Find<Button>(mask, value => Equals(value.Content, caption));
                var bounds = action.TransformToAncestor(mask).TransformBounds(new Rect(action.RenderSize));
                Assert(action.FontSize >= 14 && bounds.Left >= 0 && bounds.Right <= mask.ActualWidth + 1,
                    "Performance lock actions must remain readable and inside the narrow card");
            }
            window.Width = 1000;
            await Pump();
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
            CloseWithMouse(close);
            await Pump();
            Assert(!window.IsVisible, "Failed tray-exit scenario must begin with a hidden window");
            using (var failedExitTray = new TestOfficialTray())
            using (var failedExitBridge = new OfficialTrayBridge(failedExitTray, failedExitTray.Icon, integration.ExitApplicationAsync))
                failedExitTray.ExitItem.PerformClick();
            await Pump();
            Assert(window.IsVisible && !window.Dispatcher.HasShutdownStarted && _controller.IsManualControlRequested
                && !performance.IsEnabled && keyboard.IsEnabled, "Failed tray exit must retain EC and the performance-only lock");
            _controller.FailRelease = false;
            Pass("Failed EC handoff during tray exit leaves the application running for retry");
            _result = 0;
            if (_exitViaTray)
            {
                CloseWithMouse(close);
                await Pump();
                Assert(!window.IsVisible && _controller.IsManualControlRequested,
                    "Tray exit must be tested while the EC controller is running in the background");
                using (var tray = new TestOfficialTray())
                using (var bridge = new OfficialTrayBridge(tray, tray.Icon, integration.ExitApplicationAsync))
                    tray.ExitItem.PerformClick();
            }
            else Click(Find<Button>(root, value => Equals(value.Content, "退出程序")));
            Assert(!_controller.IsManualControlRequested && _controller.Disposed, "Explicit exit must hand off EC before shutdown");
            Pass((_exitViaTray ? "Official tray exit" : "Explicit exit button") + " hands off EC before process exit");
        }

        private static async Task Pump() { await Dispatcher.Yield(DispatcherPriority.ApplicationIdle); }
        private static void CloseWithMouse(Button close) => close.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
            { RoutedEvent = UIElement.PreviewMouseLeftButtonDownEvent });

        private static async Task VerifyResponsiveEntry(Window window, Grid root,
            SystemMonitorMgr.Views.SystemMonitorButtonView monitor, Button entry, Image icon, TextBlock label)
        {
            var nativeLabel = Find<TextBlock>(monitor, value => value.Text == "系统监视器");
            var nativeIcon = Find<Image>(monitor, value => true);
            // The official shortcut can have a narrow allocated button inside a
            // scaled home view. Its width is not a safe width for our longer caption.
            foreach (var width in new[] { 640d, 1000d, 1600d })
            foreach (var scale in new[] { 0.75, 1d, 1.25, 1.5, 2d })
            {
                window.Width = width;
                monitor.Width = 100;
                nativeLabel.FontSize = 14;
                root.LayoutTransform = new ScaleTransform(scale, scale);
                await Pump();
                root.UpdateLayout();
                await Pump();
                var text = new FormattedText(label.Text, label.Language.GetEquivalentCulture(), label.FlowDirection,
                    new Typeface(label.FontFamily, label.FontStyle, label.FontWeight, label.FontStretch),
                    label.FontSize, label.Foreground, null, TextFormattingMode.Display, VisualTreeHelper.GetDpi(label).PixelsPerDip);
                var labelBounds = label.TransformToAncestor(entry).TransformBounds(new Rect(label.RenderSize));
                Assert(label.ActualWidth + 1 >= text.WidthIncludingTrailingWhitespace
                    && labelBounds.Left >= -1 && labelBounds.Right <= entry.ActualWidth + 1
                    && labelBounds.Top >= -1 && labelBounds.Bottom <= entry.ActualHeight + 1,
                    "EC caption clipped at window " + width + ", scale " + scale
                    + "; text=" + text.WidthIncludingTrailingWhitespace + "; label=" + labelBounds + "; entry=" + entry.RenderSize);
                var entryBounds = entry.TransformToAncestor(root).TransformBounds(new Rect(entry.RenderSize));
                var startup = Find<AutoStartControl>(root, value => true);
                var startupBounds = startup.TransformToAncestor(root).TransformBounds(new Rect(startup.RenderSize));
                Assert(startupBounds.Left >= 0 && startupBounds.Right <= root.ActualWidth + 1
                    && !startupBounds.IntersectsWith(entryBounds), "Startup footer overlaps the EC entry or escapes the viewport at " + width + "/" + scale);
                var nativeIconBounds = nativeIcon.TransformToAncestor(root).TransformBounds(new Rect(nativeIcon.RenderSize));
                var iconBounds = icon.TransformToAncestor(root).TransformBounds(new Rect(icon.RenderSize));
                Assert(entryBounds.Right <= root.ActualWidth + 1 && entryBounds.Bottom <= root.ActualHeight + 1,
                    "Shortcut escaped the viewport at " + width + "/" + scale + ": " + entryBounds + "; root=" + root.RenderSize);
                Assert(label.FontSize >= 14 && icon.Width == 36 && entryBounds.Top >= 0
                    && startupBounds.Bottom <= root.ActualHeight + 1,
                    "Reserved footer must keep actions readable and within the viewport at " + width + "/" + scale);
                if (_snapshotDirectory != null && width == 640)
                {
                    System.IO.Directory.CreateDirectory(_snapshotDirectory);
                    var dpi = VisualTreeHelper.GetDpi(entry);
                    var visual = new DrawingVisual();
                    using (var context = visual.RenderOpen())
                    {
                        var area = new Rect(0, 0, entry.ActualWidth, entry.ActualHeight);
                        context.DrawRectangle(new SolidColorBrush(Color.FromRgb(36, 59, 75)), null, area);
                        context.DrawRectangle(new VisualBrush(entry), null, area);
                    }
                    var bitmap = new System.Windows.Media.Imaging.RenderTargetBitmap(
                        (int)Math.Ceiling(entry.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(entry.ActualHeight * dpi.DpiScaleY),
                        dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
                    bitmap.Render(visual);
                    var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
                    encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bitmap));
                    using (var stream = System.IO.File.Create(System.IO.Path.Combine(_snapshotDirectory, "ec-entry-" + (int)(scale * 100) + ".png")))
                        encoder.Save(stream);
                }
            }
            window.Width = 1000;
            monitor.Width = 100;
            root.LayoutTransform = Transform.Identity;
            nativeLabel.FontSize = 12;
            await Pump();
            Pass("EC caption stays readable and unclipped across 15 window/scale combinations");
        }
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

    internal sealed class TestOfficialWindow : Window
    {
        internal int OriginalCloseCalls;
        internal TestOfficialWindow(Button close) { close.Click += CloseButton_Click; }
        private void CloseButton_Click(object sender, RoutedEventArgs args)
        {
            OriginalCloseCalls++;
            throw new System.Runtime.InteropServices.COMException("No package identity", unchecked((int)0x80073D54));
        }
    }

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
