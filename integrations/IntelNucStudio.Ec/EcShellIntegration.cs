using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace IntelNucStudio.Ec
{
    internal sealed class EcShellIntegration
    {
        private readonly Application _application;
        private readonly Window _window;
        private readonly Grid _root;
        private readonly Button _entry;
        private readonly DispatcherTimer _availabilityTimer;
        private FrameworkElement _homeView;
        private Border _pageHost;
        private EcControlPage _page;
        private bool _closingPage;
        private bool _closingWindow;
        private Border _controlMask;
        private TextBlock _controlBadge;
        private ContentControl _officialMainContent;
        private bool _officialWasEnabled;
        private bool _officialLocked;
        private readonly Func<EcControlPage> _pageFactory;
        private readonly Action<Exception> _reportHandoffFailure;

        internal EcShellIntegration(Application application, Window window,
            Func<EcControlPage> pageFactory = null, Action<Exception> reportHandoffFailure = null)
        {
            _application = application;
            _window = window;
            _pageFactory = pageFactory ?? (() => new EcControlPage());
            _reportHandoffFailure = reportHandoffFailure ?? (error => MessageBox.Show(_window,
                "交还 EC 自动控制未成功，请留在此页重试：" + error.Message,
                "EC 风扇控制", MessageBoxButton.OK, MessageBoxImage.Warning));
            // Prism regions are tied to the original visual tree. Never detach/reparent
            // Window.Content after startup: doing so can unregister the official regions.
            var officialContent = window.Content as UIElement;
            if (officialContent == null) throw new InvalidOperationException("官方窗口没有可挂接的 WPF 内容。");
            _root = FindShellGrid(officialContent);
            if (_root == null) throw new InvalidOperationException("没有找到官方主窗口的布局容器，停止加载 EC 页面。");
            IntegrationDiagnostics.Write("Official content before integration: " + DescribeTree(officialContent));

            _entry = new Button
            {
                Name = "NssEcModuleEntry",
                Content = "✣  EC 风扇控制",
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(130, 0, 0, 18),
                Padding = new Thickness(16, 10, 16, 10),
                FontSize = 15,
                Background = Brush("#172C3B"),
                Foreground = Brush("#00AFE5"),
                BorderBrush = Brush("#406073"),
                BorderThickness = new Thickness(1),
                ToolTip = "打开 EC 直连风扇控制；不会自动改变厂商性能档位",
                Visibility = Visibility.Collapsed
            };
            _entry.Click += (sender, args) => OpenPage();
            SpanShell(_entry);
            Panel.SetZIndex(_entry, 100);
            _root.Children.Add(_entry);
            BuildControlMask();
            _availabilityTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _availabilityTimer.Tick += (sender, args) => UpdateEntryVisibility();
            _availabilityTimer.Start();
            // Layout can change when Prism replaces its active view. The home
            // view's visibility event covers removal without waiting for a timer.
            window.LayoutUpdated += (sender, args) => UpdateEntryVisibility();
            UpdateEntryVisibility();
            var closeButton = FindCloseButton(officialContent);
            if (closeButton != null)
            {
                closeButton.PreviewMouseLeftButtonDown += async (sender, args) =>
                {
                    args.Handled = true;
                    await ExitApplicationAsync();
                };
                closeButton.ToolTip = "交还 EC 自动控制并退出程序";
            }
            window.PreviewKeyDown += async (sender, args) =>
            {
                if (args.Key == Key.System && args.SystemKey == Key.F4)
                {
                    args.Handled = true;
                    await ExitApplicationAsync();
                }
            };
            // The official OnClosing override intentionally hides/cancels and does
            // not raise Window.Closing. Observe visibility for tray handoff instead.
            window.IsVisibleChanged += async (sender, args) =>
            {
                if (!(bool)args.NewValue && _page != null)
                {
                    await ClosePageAsync();
                    if (_page != null) _window.Show();
                }
            };
            application.Exit += OnApplicationExit;
            application.SessionEnding += (sender, args) => ReleaseBeforeExit();
            IntegrationDiagnostics.Write("Integrated: app=" + application.GetType().FullName
                + "; window=" + window.GetType().FullName + "; officialAssembly=" + window.GetType().Assembly.Location
                + "; entry=" + _entry.Name + "; pid=" + System.Diagnostics.Process.GetCurrentProcess().Id);
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "tray") < 0)
                window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => { window.Show(); window.Activate(); }));
        }

        private static Button FindCloseButton(DependencyObject node)
        {
            // The original BAML uses the Segoe MDL2 close glyph in a Viewbox.
            if (node is TextBlock text && text.Text == "\uE106")
            {
                for (var parent = VisualTreeHelper.GetParent(node); parent != null; parent = VisualTreeHelper.GetParent(parent))
                    if (parent is Button button) return button;
            }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = FindCloseButton(VisualTreeHelper.GetChild(node, i));
                if (found != null) return found;
            }
            return null;
        }

        private static Grid FindShellGrid(DependencyObject node)
        {
            if (node is Grid grid) return grid;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = FindShellGrid(VisualTreeHelper.GetChild(node, i));
                if (found != null) return found;
            }
            return null;
        }

        private static string DescribeTree(DependencyObject node)
        {
            var text = new System.Text.StringBuilder();
            DescribeTree(node, text, 0);
            return text.ToString();
        }

        private static void DescribeTree(DependencyObject node, System.Text.StringBuilder text, int depth)
        {
            if (depth > 12 || text.Length > 20000) return;
            if (node is FrameworkElement element)
                text.Append(element.GetType().FullName).Append('(').Append(element.Name).Append(");");
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                DescribeTree(VisualTreeHelper.GetChild(node, i), text, depth + 1);
        }

        private void SpanShell(FrameworkElement element)
        {
            Grid.SetRowSpan(element, Math.Max(1, _root.RowDefinitions.Count));
            Grid.SetColumnSpan(element, Math.Max(1, _root.ColumnDefinitions.Count));
        }

        public static void Install(Application application, Window window)
        {
            // Retained by the window events for its lifetime.
            new EcShellIntegration(application, window);
        }

        private static bool ReadFlag(object instance, string property) =>
            instance?.GetType().GetProperty(property)?.GetValue(instance) is bool value && value;

        private void UpdateEntryVisibility()
        {
            var currentHome = FindHomeView(_root);
            if (!ReferenceEquals(currentHome, _homeView))
            {
                if (_homeView != null) _homeView.IsVisibleChanged -= OnHomeVisibilityChanged;
                _homeView = currentHome;
                if (_homeView != null) _homeView.IsVisibleChanged += OnHomeVisibilityChanged;
            }
            var context = _window.DataContext;
            var show = _homeView?.IsVisible == true && (_pageHost == null || _pageHost.Visibility != Visibility.Visible)
                && _page?.HasControlRequest != true
                && !ReadFlag(context, "ShowEula") && !ReadFlag(context, "SettingsVisible");
            _entry.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            UpdateControlMask();
        }

        private void BuildControlMask()
        {
            var content = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 620 };
            content.Children.Add(new TextBlock { Text = "EC控制中", Foreground = Brush("#FF4141"), FontSize = 34, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center });
            content.Children.Add(new TextBlock { Text = "官方设备设置已锁定，请先停止 EC 控制再调整。", Foreground = Brush("#E4EDF3"), FontSize = 18, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 14, 0, 25), TextAlignment = TextAlignment.Center });
            var buttons = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Center };
            var open = new Button { Content = "返回 EC 控制", Padding = new Thickness(18, 10, 18, 10), Margin = new Thickness(8), FontSize = 16 };
            open.Click += (sender, args) => OpenPage();
            var stop = new Button { Content = "停止 EC 并解锁", Padding = new Thickness(18, 10, 18, 10), Margin = new Thickness(8), FontSize = 16 };
            stop.Click += async (sender, args) => await ClosePageAsync();
            buttons.Children.Add(open);
            buttons.Children.Add(stop);
            content.Children.Add(buttons);
            _controlMask = new Border
            {
                Name = "NssEcControlMask", Background = Brush("#E610202D"),
                Margin = new Thickness(0, 56, 0, 0), Visibility = Visibility.Collapsed,
                Child = content, IsHitTestVisible = true
            };
            SpanShell(_controlMask);
            Panel.SetZIndex(_controlMask, 150);
            _root.Children.Add(_controlMask);
        }

        private void UpdateControlMask()
        {
            var active = _page?.HasControlRequest == true;
            if (_controlMask != null) _controlMask.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            if (_controlBadge != null) _controlBadge.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            if (active && !_officialLocked)
            {
                _officialMainContent = FindOfficialMainContent(_root);
                if (_officialMainContent != null)
                {
                    _officialWasEnabled = _officialMainContent.IsEnabled;
                    _officialMainContent.SetCurrentValue(UIElement.IsEnabledProperty, false);
                    _officialLocked = true;
                }
            }
            else if (!active && _officialLocked)
            {
                _officialMainContent.SetCurrentValue(UIElement.IsEnabledProperty, _officialWasEnabled);
                _officialLocked = false;
            }
        }

        private static ContentControl FindOfficialMainContent(DependencyObject node)
        {
            if (node is ContentControl control && (control.Content?.GetType().FullName == "FeatureMgr.Views.ProfilesView"
                || control.Content?.GetType().FullName == "FeatureMgr.Views.DetailView")) return control;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = FindOfficialMainContent(VisualTreeHelper.GetChild(node, i));
                if (found != null) return found;
            }
            return null;
        }

        private void OnHomeVisibilityChanged(object sender, DependencyPropertyChangedEventArgs args) => UpdateEntryVisibility();

        private static FrameworkElement FindHomeView(DependencyObject node)
        {
            if (node is FrameworkElement element && element.GetType().FullName == "FeatureMgr.Views.ProfilesView") return element;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = FindHomeView(VisualTreeHelper.GetChild(node, i));
                if (found != null) return found;
            }
            return null;
        }

        private void OpenPage()
        {
            if (_pageHost != null)
            {
                _pageHost.Visibility = Visibility.Visible;
                UpdateEntryVisibility();
                return;
            }
            _page = _pageFactory();
            _page.ControlStateChanged += (sender, args) => UpdateEntryVisibility();
            var layout = new Grid();
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            layout.RowDefinitions.Add(new RowDefinition());
            var toolbar = new DockPanel { Margin = new Thickness(22, 15, 22, 10) };
            var exit = new Button { Content = "退出程序", Padding = new Thickness(12, 7, 12, 7), FontSize = 15 };
            DockPanel.SetDock(exit, Dock.Right);
            exit.Click += async (sender, args) => await ExitApplicationAsync();
            toolbar.Children.Add(exit);
            var back = new Button { Content = "‹  返回官方主页", Padding = new Thickness(12, 7, 12, 7), FontSize = 15 };
            back.Click += async (sender, args) =>
            {
                if (_page?.HasControlRequest == true)
                {
                    _pageHost.Visibility = Visibility.Collapsed;
                    UpdateEntryVisibility();
                }
                else await ClosePageAsync();
            };
            toolbar.Children.Add(back);
            toolbar.Children.Add(new TextBlock
            {
                Text = "EC 风扇控制",
                Foreground = Brush("#00AFE5"), FontSize = 23,
                Margin = new Thickness(24, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center
            });
            _controlBadge = new TextBlock
            {
                Text = "EC控制中", Foreground = Brush("#FF4141"), FontWeight = FontWeights.Bold,
                FontSize = 21, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(22, 0, 0, 0),
                Visibility = Visibility.Collapsed
            };
            toolbar.Children.Add(_controlBadge);
            layout.Children.Add(toolbar);
            Grid.SetRow(_page, 1);
            layout.Children.Add(_page);
            _pageHost = new Border { Background = Brush("#243B4B"), Margin = new Thickness(0, 56, 0, 0), Child = layout };
            SpanShell(_pageHost);
            Panel.SetZIndex(_pageHost, 200);
            _root.Children.Add(_pageHost);
            _entry.Visibility = Visibility.Collapsed;
            UpdateControlMask();
            IntegrationDiagnostics.Write("EC page opened inside official window; no EC writes requested.");
        }

        private async Task ClosePageAsync()
        {
            if (_closingPage || _page == null) return;
            _closingPage = true;
            try
            {
                await _page.DeactivateAsync();
                _root.Children.Remove(_pageHost);
                _page.Dispose();
                _page = null;
                _pageHost = null;
                _controlBadge = null;
                UpdateEntryVisibility();
                IntegrationDiagnostics.Write("EC page closed; official content retained.");
            }
            catch (Exception error)
            {
                _reportHandoffFailure(error);
            }
            finally { _closingPage = false; }
        }

        private async Task ExitApplicationAsync()
        {
            if (_closingWindow) return;
            _closingWindow = true;
            try
            {
                await ClosePageAsync();
                if (_page != null) { _closingWindow = false; return; }
                _application.Shutdown();
            }
            catch (Exception error) { _closingWindow = false; IntegrationDiagnostics.Write("Close cleanup failed: " + error); }
        }

        private void OnApplicationExit(object sender, ExitEventArgs args)
        {
            _availabilityTimer.Stop();
            ReleaseBeforeExit();
        }

        private void ReleaseBeforeExit()
        {
            try { _page?.ReleaseBeforeProcessExit(); }
            catch (Exception error) { IntegrationDiagnostics.Write("Exit cleanup failed: " + error); }
        }

        private static SolidColorBrush Brush(string value) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
    }
}
