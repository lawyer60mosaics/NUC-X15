using System;
using System.Collections.Generic;
using System.Reflection;
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
        private readonly Image _entryIcon;
        private readonly TextBlock _entryCaption;
        private FrameworkElement _monitorView;
        private readonly DispatcherTimer _availabilityTimer;
        private FrameworkElement _homeView;
        private Border _pageHost;
        private EcControlPage _page;
        private bool _closingPage;
        private bool _closingWindow;
        private Border _controlMask;
        private TextBlock _controlBadge;
        private readonly Dictionary<FrameworkElement, bool> _lockedPerformanceViews = new Dictionary<FrameworkElement, bool>();
        private OfficialTrayBridge _trayBridge;
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

            _entryIcon = new Image { Source = CreateEcIcon(), Width = 36, Height = 36, Margin = new Thickness(0, 0, 0, 4) };
            _entryCaption = new TextBlock
            {
                Text = "EC 风扇控制", FontSize = 12, Foreground = Brush("#00AFE5"),
                HorizontalAlignment = HorizontalAlignment.Center,
                TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.None
            };
            var entryContent = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top };
            entryContent.Children.Add(_entryIcon);
            entryContent.Children.Add(_entryCaption);
            _entry = new Button
            {
                Name = "NssEcModuleEntry",
                Content = entryContent,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(130, 0, 0, 12),
                Width = 100, Height = 70, Padding = new Thickness(0),
                Background = Brushes.Transparent,
                Foreground = Brush("#00AFE5"),
                BorderBrush = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand,
                UseLayoutRounding = true, SnapsToDevicePixels = true,
                Template = CreateModuleEntryTemplate(),
                ToolTip = "打开 EC 直连风扇控制；不会自动改变厂商性能档位",
                Visibility = Visibility.Collapsed
            };
            TextOptions.SetTextFormattingMode(_entry, TextFormattingMode.Display);
            _entry.Click += (sender, args) => OpenPage();
            SpanShell(_entry);
            Panel.SetZIndex(_entry, 100);
            _root.Children.Add(_entry);
            BuildControlMask();
            _availabilityTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _availabilityTimer.Tick += (sender, args) =>
            {
                UpdateEntryVisibility();
                if (_trayBridge == null) _trayBridge = OfficialTrayBridge.TryAttach(_application, ExitApplicationAsync);
                _trayBridge?.Sync(_page?.HasControlRequest == true);
            };
            _availabilityTimer.Start();
            // Layout can change when Prism replaces its active view. The home
            // view's visibility event covers removal without waiting for a timer.
            window.LayoutUpdated += (sender, args) => UpdateEntryVisibility();
            UpdateEntryVisibility();
            var closeButton = FindCloseButton(officialContent);
            if (closeButton != null)
            {
                // Also cover Click raised by keyboard/accessibility automation.
                // The original callback hides, then accesses MSIX-only settings.
                var method = window.GetType().GetMethod("CloseButton_Click", BindingFlags.Instance | BindingFlags.NonPublic);
                var originalClose = method == null ? null : Delegate.CreateDelegate(typeof(RoutedEventHandler), window, method, false) as RoutedEventHandler;
                if (originalClose != null) closeButton.Click -= originalClose;
                closeButton.Click += (sender, args) => { args.Handled = true; HideToTray(); };
                closeButton.PreviewMouseLeftButtonDown += (sender, args) =>
                {
                    args.Handled = true;
                    HideToTray();
                };
                closeButton.PreviewKeyDown += (sender, args) =>
                {
                    if (args.Key != Key.Return && args.Key != Key.Space) return;
                    args.Handled = true;
                    HideToTray();
                };
                closeButton.ToolTip = "隐藏到托盘，程序继续运行";
            }
            window.PreviewKeyDown += (sender, args) =>
            {
                if (args.Key == Key.System && args.SystemKey == Key.F4)
                {
                    args.Handled = true;
                    HideToTray();
                }
            };
            // The official OnClosing override already hides/cancels. Retain the
            // same behavior for any shell that raises Closing (including tests).
            // Hiding must not deactivate the EC page or hand control back.
            window.Closing += (sender, args) =>
            {
                if (_closingWindow) return;
                args.Cancel = true;
                HideToTray();
            };
            application.Exit += OnApplicationExit;
            application.SessionEnding += (sender, args) => ReleaseBeforeExit();
            _trayBridge = OfficialTrayBridge.TryAttach(_application, ExitApplicationAsync);
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
                && !ReadFlag(context, "ShowEula") && !ReadFlag(context, "SettingsVisible");
            _entry.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            UpdateControlMask();
            if (show) MatchSystemMonitorEntry();
        }

        private static ControlTemplate CreateModuleEntryTemplate()
        {
            var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
            presenter.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            presenter.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Top);
            var surface = new FrameworkElementFactory(typeof(Border));
            surface.SetValue(Border.BackgroundProperty, Brushes.Transparent);
            surface.AppendChild(presenter);
            var template = new ControlTemplate(typeof(Button)) { VisualTree = surface };
            var hover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hover.Setters.Add(new Setter(UIElement.OpacityProperty, 0.8));
            template.Triggers.Add(hover);
            return template;
        }

        private static ImageSource CreateEcIcon()
        {
            var drawing = new DrawingGroup();
            drawing.Children.Add(new GeometryDrawing(Brush("#00AFE5"), null, new RectangleGeometry(new Rect(0, 0, 36, 36), 3, 3)));
            var fan = Geometry.Parse("M18,16 C9,17 6,11 10,7 C15,3 20,9 20,14 Z M20,18 C25,9 32,12 32,18 C32,25 24,24 21,21 Z M17,20 C22,27 17,33 12,30 C6,27 10,22 14,19 Z");
            drawing.Children.Add(new GeometryDrawing(Brush("#10212C"), null, fan));
            drawing.Children.Add(new GeometryDrawing(Brush("#10212C"), null, new EllipseGeometry(new Point(18, 18), 3, 3)));
            drawing.Freeze();
            return new DrawingImage(drawing);
        }

        private void MatchSystemMonitorEntry()
        {
            if (_monitorView == null || !_root.IsAncestorOf(_monitorView))
                _monitorView = FindElement<FrameworkElement>(_root, value => value.GetType().FullName == "SystemMonitorMgr.Views.SystemMonitorButtonView");
            if (_monitorView?.IsVisible != true || !_root.IsAncestorOf(_monitorView)) return;
            var button = FindElement<Button>(_monitorView, value => true);
            if (button == null || !_root.IsAncestorOf(button) || button.ActualWidth <= 0 || button.ActualHeight <= 0) return;
            var bounds = button.TransformToAncestor(_root).TransformBounds(new Rect(0, 0, button.ActualWidth, button.ActualHeight));
            var top = bounds.Top;
            var gap = 4d;
            var icon = FindElement<Image>(button, value => value.ActualWidth > 0 && value.ActualHeight > 0);
            var iconBounds = bounds;
            if (icon != null)
            {
                iconBounds = icon.TransformToAncestor(_root).TransformBounds(new Rect(0, 0, icon.ActualWidth, icon.ActualHeight));
                _entryIcon.Width = Math.Round(iconBounds.Width, 3);
                _entryIcon.Height = Math.Round(iconBounds.Height, 3);
                top = iconBounds.Top;
            }
            var caption = FindElement<TextBlock>(button, value => !string.IsNullOrWhiteSpace(value.Text));
            if (caption != null)
            {
                var scale = caption.TransformToAncestor(_root).TransformBounds(new Rect(0, 0, 1, 1)).Height;
                _entryCaption.FontSize = Math.Max(12, caption.FontSize * scale);
                _entryCaption.FontFamily = caption.FontFamily;
                _entryCaption.FontWeight = caption.FontWeight;
                if (icon != null)
                {
                    var captionBounds = caption.TransformToAncestor(_root).TransformBounds(new Rect(caption.RenderSize));
                    gap = Math.Max(4, captionBounds.Top - iconBounds.Bottom);
                }
            }
            _entryIcon.Margin = new Thickness(0, 0, 0, gap);
            // The official button's allocated width may be narrower than its own
            // caption. Measure our longer caption independently of that allocation;
            // copying the fixed width clips both ends under the original Viewbox.
            var text = new FormattedText(_entryCaption.Text, _entryCaption.Language.GetEquivalentCulture(),
                _entryCaption.FlowDirection, new Typeface(_entryCaption.FontFamily, _entryCaption.FontStyle,
                    _entryCaption.FontWeight, _entryCaption.FontStretch), _entryCaption.FontSize,
                _entryCaption.Foreground, null, TextFormattingMode.Display, VisualTreeHelper.GetDpi(_entryCaption).PixelsPerDip);
            _entry.VerticalAlignment = VerticalAlignment.Top;
            _entry.Width = Math.Ceiling(Math.Max(bounds.Width, Math.Max(_entryIcon.Width, text.WidthIncludingTrailingWhitespace) + 16));
            _entry.Height = Math.Ceiling(_entryIcon.Height + gap + text.Height + 4);
            // Keep the complete caption above the window edge when a smaller
            // home scale leaves less footer space than the minimum readable text.
            top = Math.Max(0, Math.Min(top, _root.ActualHeight - _entry.Height));
            _entry.Margin = new Thickness(Math.Round(bounds.Right + Math.Max(12, _entryIcon.Width * 0.5), 3), Math.Round(top, 3), 0, 0);
        }

        private static T FindElement<T>(DependencyObject node, Predicate<T> matches) where T : DependencyObject
        {
            if (node is T value && matches(value)) return value;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var found = FindElement(VisualTreeHelper.GetChild(node, i), matches);
                if (found != null) return found;
            }
            return null;
        }

        private void BuildControlMask()
        {
            var content = new StackPanel { Width = 420, Margin = new Thickness(16), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            content.Children.Add(new TextBlock { Text = "EC控制中", Foreground = Brush("#FF4141"), FontSize = 26, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center });
            content.Children.Add(new TextBlock { Text = "性能调优已锁定，其余功能可正常使用。", Foreground = Brush("#E4EDF3"), FontSize = 16, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12, 0, 18), TextAlignment = TextAlignment.Center });
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
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
                Visibility = Visibility.Collapsed, ClipToBounds = true,
                Child = new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.DownOnly, Child = content }, IsHitTestVisible = true
            };
            SpanShell(_controlMask);
            Panel.SetZIndex(_controlMask, 150);
            _root.Children.Add(_controlMask);
        }

        private void UpdateControlMask()
        {
            var active = _page?.HasControlRequest == true;
            if (_controlBadge != null) _controlBadge.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            FrameworkElement visiblePerformance = null;
            if (active)
            {
                foreach (var view in FindPerformanceViews(_root))
                {
                    if (!_lockedPerformanceViews.ContainsKey(view))
                    {
                        _lockedPerformanceViews.Add(view, view.IsEnabled);
                        view.SetCurrentValue(UIElement.IsEnabledProperty, false);
                    }
                    if (view.IsVisible) visiblePerformance = view;
                }
            }
            else if (_lockedPerformanceViews.Count > 0)
            {
                foreach (var view in _lockedPerformanceViews) view.Key.SetCurrentValue(UIElement.IsEnabledProperty, view.Value);
                _lockedPerformanceViews.Clear();
            }
            if (_controlMask != null)
            {
                // IsVisibleChanged can fire while Prism detaches a view. Its
                // visibility cache can still be true after the ancestor link is gone.
                if (visiblePerformance != null && _root.IsAncestorOf(visiblePerformance)
                    && visiblePerformance.ActualWidth > 0 && visiblePerformance.ActualHeight > 0)
                {
                    var bounds = visiblePerformance.TransformToAncestor(_root).TransformBounds(
                        new Rect(0, 0, visiblePerformance.ActualWidth, visiblePerformance.ActualHeight));
                    _controlMask.Width = Math.Round(bounds.Width, 3);
                    _controlMask.Height = Math.Round(bounds.Height, 3);
                    _controlMask.Margin = new Thickness(Math.Round(bounds.Left, 3), Math.Round(bounds.Top, 3), 0, 0);
                    _controlMask.Visibility = Visibility.Visible;
                }
                else _controlMask.Visibility = Visibility.Collapsed;
            }
            _trayBridge?.Sync(active);
        }

        private static IEnumerable<FrameworkElement> FindPerformanceViews(DependencyObject node)
        {
            var name = node.GetType().FullName;
            if (node is FrameworkElement view && (name == "MobilePerformanceMgr.Views.MobilePerformanceSummaryView"
                || name == "MobilePerformanceMgr.Views.MobilePerformanceView"))
            {
                yield return view;
                yield break;
            }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                foreach (var child in FindPerformanceViews(VisualTreeHelper.GetChild(node, i))) yield return child;
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

        internal async Task ExitApplicationAsync()
        {
            if (_closingWindow) return;
            _closingWindow = true;
            try
            {
                await ClosePageAsync();
                if (_page != null)
                {
                    _closingWindow = false;
                    OpenPage();
                    _window.Show();
                    _window.Activate();
                    return;
                }
                _application.Shutdown();
            }
            catch (Exception error) { _closingWindow = false; IntegrationDiagnostics.Write("Close cleanup failed: " + error); }
        }

        private void HideToTray()
        {
            if (_closingWindow) return;
            _window.Hide();
        }

        private void OnApplicationExit(object sender, ExitEventArgs args)
        {
            _availabilityTimer.Stop();
            ReleaseBeforeExit();
            _trayBridge?.Dispose();
        }

        private void ReleaseBeforeExit()
        {
            try { _page?.ReleaseBeforeProcessExit(); }
            catch (Exception error) { IntegrationDiagnostics.Write("Exit cleanup failed: " + error); }
        }

        private static SolidColorBrush Brush(string value) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
    }
}
