using System;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Threading.Tasks;
using IntelNucStudio.Ec;

namespace IntelNucStudio.Ec.Tests
{
    internal static class IndustrialThemeScenarios
    {
        internal static async Task Run(Application app, string official, string snapshots, Action<string> pass)
        {
            var palette = IndustrialTheme.CreateResources();
            var panel = ((SolidColorBrush)palette["CardBackgroundBrush"]).Color;
            foreach (var key in new[] { "MainTextBrush", "IndustrialMutedBrush", "IconBrush", "DisableControlForeground" })
                Assert(Contrast(((SolidColorBrush)palette[key]).Color, panel) >= 4.5, "Low contrast: " + key);
            Assert(Contrast(((SolidColorBrush)palette["IndustrialAccentTextBrush"]).Color, ((SolidColorBrush)palette["IconBrush"]).Color) >= 4.5,
                "Enabled toggle label must remain readable on cyan");
            pass("Industrial text, muted status and switch labels meet 4.5:1 contrast");
            if (!string.IsNullOrWhiteSpace(official))
            {
                using (var fixture = new OfficialThemeFixture(official))
                {
                    fixture.LoadControls(app);
                    var model = new ThemeModel();
                    var button = new TestButton { Content = "应用设置", Style = (Style)app.FindResource("RectangleButton"), Margin = new Thickness(12) };
                    button.SetBinding(Button.CommandProperty, new Binding(nameof(ThemeModel.Command)) { Source = model });
                    var toggle = new TestToggle { Style = (Style)app.FindResource("OnOffToggle"), Margin = new Thickness(12) };
                    toggle.SetBinding(ToggleButton.IsCheckedProperty, new Binding(nameof(ThemeModel.Checked)) { Source = model, Mode = BindingMode.TwoWay });
                    var slider = new Slider { Minimum = 0, Maximum = 100, Width = 260, Style = (Style)app.FindResource("MainKCSliderStyle"), Margin = new Thickness(12) };
                    slider.SetBinding(RangeBase.ValueProperty, new Binding(nameof(ThemeModel.Value)) { Source = model, Mode = BindingMode.TwoWay });
                    var combo = new ComboBox { Width = 260, Style = (Style)app.FindResource("ComboBoxStyle"), ItemsSource = new[] { "标准", "游戏", "视频", "阅读" }, Margin = new Thickness(12) };
                    combo.SetBinding(Selector.SelectedIndexProperty, new Binding(nameof(ThemeModel.Selected)) { Source = model, Mode = BindingMode.TwoWay });
                    var checkbox = new CheckBox { Content = "保留原有状态绑定", Style = (Style)app.FindResource("CustomCheckBox"), Margin = new Thickness(12) };
                    checkbox.SetBinding(ToggleButton.IsCheckedProperty, new Binding(nameof(ThemeModel.Checked)) { Source = model, Mode = BindingMode.TwoWay });
                    var radio = new RadioButton { Content = "标准", Style = (Style)app.FindResource("RadioButtonControlBlue"), Margin = new Thickness(12) };
                    var title = new TextBlock { Text = "工业控件 · 原版样式验证", Style = (Style)app.FindResource("MainPageCardTitleText"), Margin = new Thickness(12) };
                    var content = new StackPanel();
                    foreach (var element in new FrameworkElement[] { title, button, toggle, slider, combo, checkbox, radio }) content.Children.Add(element);
                    var root = new Border { Padding = new Thickness(24), Child = content };
                    root.SetResourceReference(Border.BackgroundProperty, "CardBackgroundBrush");
                    var window = new Window { Content = root, Width = 700, Height = 660, Left = -15000, Top = -15000, Opacity = 0, ShowInTaskbar = false };
                    window.Show();
                    await Pump();
                    var command = BindingOperations.GetBindingExpression(button, Button.CommandProperty);
                    var checkedBinding = BindingOperations.GetBindingExpression(toggle, ToggleButton.IsCheckedProperty);
                    var valueBinding = BindingOperations.GetBindingExpression(slider, RangeBase.ValueProperty);
                    var theme = IndustrialTheme.Install(app, window);
                    Assert(ReferenceEquals(theme, IndustrialTheme.Install(app, window)), "Theme installation must be idempotent");
                    await Pump();
                    Assert(ReferenceEquals(window.Content, root) && ReferenceEquals(command, BindingOperations.GetBindingExpression(button, Button.CommandProperty))
                        && ReferenceEquals(checkedBinding, BindingOperations.GetBindingExpression(toggle, ToggleButton.IsCheckedProperty))
                        && ReferenceEquals(valueBinding, BindingOperations.GetBindingExpression(slider, RangeBase.ValueProperty)), "Skinning must not reparent the shell or replace hardware bindings");
                    button.InvokeClick();
                    toggle.InvokeClick();
                    slider.Value = 60;
                    combo.SelectedIndex = 2;
                    Assert(model.Clicks == 1 && model.Checked && model.Value == 60 && model.Selected == 2, "Native control actions stopped updating their original models");
                    Assert(toggle.Template == window.FindResource("IndustrialToggleTemplate")
                        && combo.Template == window.FindResource("IndustrialComboTemplate"), "Actual native style instances did not receive industrial templates");
                    Assert(((SolidColorBrush)root.Background).Color == panel, "Native DynamicResource backgrounds did not update");
                    Assert(Contrast(((SolidColorBrush)checkbox.Foreground).Color, panel) >= 4.5
                        && Contrast(((SolidColorBrush)radio.Foreground).Color, panel) >= 4.5,
                        "Original checkbox/radio text must remain readable after remapping vendor brush roles");
                    pass("Real vendor button, toggle, slider and dropdown keep their commands and two-way bindings after skinning");
                    combo.IsEditable = true;
                    await Pump();
                    var edit = (TextBox)combo.Template.FindName("PART_EditableTextBox", combo);
                    edit.Text = "自定义配置";
                    await Pump();
                    Assert(edit.IsVisible && combo.Text == "自定义配置", "Editable dropdown lost the PART_EditableTextBox contract");
                    combo.IsEditable = false;
                    combo.IsDropDownOpen = true;
                    await Pump();
                    var popup = (Popup)combo.Template.FindName("PART_Popup", combo);
                    Assert(popup.IsOpen && combo.ItemContainerGenerator.ContainerFromIndex(0) is ComboBoxItem, "Dropdown failed to open/render its items");
                    combo.IsDropDownOpen = false;
                    combo.SelectedIndex = 0;
                    toggle.IsEnabled = false;
                    await Pump();
                    Assert(!toggle.IsEnabled && model.Checked, "Disabled appearance must not reset hardware state");
                    Assert(button.FocusVisualStyle != null && slider.Focusable, "Keyboard focus and slider navigation must remain available");
                    Slider.IncreaseSmall.Execute(null, slider);
                    Assert(model.Value > 60, "Keyboard slider commands stopped functioning");
                    pass("Editable dropdowns, popup items, disabled state and keyboard slider commands preserve native contracts");
                    if (snapshots != null) Save(root, Path.Combine(snapshots, "industrial-native-controls.png"));
                    window.Close();
                    var home = new Grid { Background = (Brush)app.FindResource("MainBackgroundBrush"), Margin = new Thickness(20) };
                    home.RowDefinitions.Add(new RowDefinition());
                    home.RowDefinitions.Add(new RowDefinition());
                    var top = new UniformGrid { Columns = 2 };
                    var bottom = new UniformGrid { Columns = 3 };
                    home.Children.Add(top); Grid.SetRow(bottom, 1); home.Children.Add(bottom);
                    var homeWindow = new Window { Content = home, Width = 1700, Height = 1000, Left = -15000, Top = -15000, Opacity = 0, ShowInTaskbar = false };
                    app.MainWindow = homeWindow;
                    homeWindow.Show();
                    await Pump();
                    var homeCards = fixture.LoadHomeCards(app);
                    for (var i = 0; i < homeCards.Length; i++)
                    {
                        homeCards[i].Margin = new Thickness(8);
                        (i < 2 ? top : bottom).Children.Add(homeCards[i]);
                    }
                    await Pump();
                    IndustrialTheme.Install(app, homeWindow, home);
                    await Pump();
                    Assert(homeCards.Length == 5 && top.Children.Count == 2 && bottom.Children.Count == 3,
                        "All five official home card views must remain present in their original grouping");
                    if (snapshots != null) Save(home, Path.Combine(snapshots, "industrial-official-home-empty-data.png"));
                    homeWindow.Close();
                    pass("All five original home card BAML views render with industrial styling and no vendor models/services");
                    app.Resources.Clear();
                    app.Resources.MergedDictionaries.Clear();
                }
            }

            var controller = new FakeController();
            using (var page = new EcControlPage(controller, () => { }))
            {
                var window = new Window { Content = page, Width = 1280, Height = 860, Left = -15000, Top = -15000, Opacity = 0, ShowInTaskbar = false };
                window.Show();
                await Pump();
                foreach (var width in new[] { 640d, 800d, 1024d, 1440d })
                {
                    window.Width = width;
                    ((ScrollViewer)page.Content).ScrollToTop();
                    await Pump();
                    window.UpdateLayout();
                    await Pump();
                    var fixedPanel = (Border)page.FindName("FixedPanel");
                    var metrics = (UniformGrid)page.FindName("MetricsGrid");
                    var compact = page.ActualWidth < 900;
                    Assert(Grid.GetRow(fixedPanel) == (compact ? 1 : 0) && metrics.Columns == (compact ? 2 : 4), "EC page did not reflow at " + width);
                    foreach (var name in new[] { "QuietPreset", "BalancedPreset", "PerformancePreset", "LeftSpeed", "RightSpeed" })
                    {
                        var control = (FrameworkElement)page.FindName(name);
                        var bounds = control.TransformToAncestor(page).TransformBounds(new Rect(control.RenderSize));
                        Assert(bounds.Left >= -1 && bounds.Right <= page.ActualWidth + 1, "Control clipped horizontally: " + name + " at " + width);
                    }
                    Assert(!controller.IsManualControlRequested && controller.StartCalls == 0, "Resizing or skinning must not issue fan requests");
                    if (snapshots != null && (width == 640 || width == 1440)) Save(page, Path.Combine(snapshots, "industrial-ec-" + (int)width + ".png"));
                    ((ScrollViewer)page.Content).ScrollToBottom();
                    await Pump();
                    var release = (Button)page.FindName("ReleaseButton");
                    var releaseBounds = release.TransformToAncestor(page).TransformBounds(new Rect(release.RenderSize));
                    Assert(releaseBounds.Top >= 0 && releaseBounds.Bottom <= page.ActualHeight + 1, "Recovery control cannot be reached by scrolling at " + width);
                }
                window.Close();
                pass("EC page reflows at four desktop widths without clipping controls or sending hardware commands");
            }
        }

        private static async Task Pump() { await Dispatcher.Yield(DispatcherPriority.ApplicationIdle); }
        private static void Save(FrameworkElement element, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var bitmap = new RenderTargetBitmap((int)Math.Ceiling(element.ActualWidth), (int)Math.Ceiling(element.ActualHeight), 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(element);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using (var stream = File.Create(path)) encoder.Save(stream);
        }
        private static double Contrast(Color first, Color second)
        {
            var a = Luminance(first); var b = Luminance(second);
            return (Math.Max(a, b) + 0.05) / (Math.Min(a, b) + 0.05);
        }
        private static double Luminance(Color color)
        {
            Func<byte, double> linear = value => { var x = value / 255d; return x <= 0.04045 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4); };
            return linear(color.R) * 0.2126 + linear(color.G) * 0.7152 + linear(color.B) * 0.0722;
        }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
        private sealed class TestButton : Button { internal void InvokeClick() => OnClick(); }
        private sealed class TestToggle : ToggleButton { internal void InvokeClick() => OnClick(); }
        private sealed class ThemeModel : INotifyPropertyChanged
        {
            private bool _checked; private double _value = 40; private int _selected;
            public int Clicks;
            public ICommand Command { get; }
            public ThemeModel() { Command = new ClickCommand(() => Clicks++); }
            public bool Checked { get => _checked; set { _checked = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Checked))); } }
            public double Value { get => _value; set { _value = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Value))); } }
            public int Selected { get => _selected; set { _selected = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Selected))); } }
            public event PropertyChangedEventHandler PropertyChanged;
        }
        private sealed class ClickCommand : ICommand
        {
            private readonly Action _click;
            internal ClickCommand(Action click) { _click = click; }
            public bool CanExecute(object parameter) => true;
            public void Execute(object parameter) => _click();
            public event EventHandler CanExecuteChanged { add { } remove { } }
        }
    }
}
