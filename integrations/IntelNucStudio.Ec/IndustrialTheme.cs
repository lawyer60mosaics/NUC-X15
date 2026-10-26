using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Effects;

namespace IntelNucStudio.Ec
{
    internal sealed class IndustrialTheme
    {
        internal static readonly FontFamily BodyFont = new FontFamily("Segoe UI, Microsoft YaHei UI");
        private static readonly ConditionalWeakTable<Window, IndustrialTheme> Windows = new ConditionalWeakTable<Window, IndustrialTheme>();
        private readonly Dictionary<Style, Style> _styles = new Dictionary<Style, Style>();
        private readonly Dictionary<ControlTemplate, ControlTemplate> _templates = new Dictionary<ControlTemplate, ControlTemplate>();
        private readonly ConditionalWeakTable<FrameworkElement, object> _framed = new ConditionalWeakTable<FrameworkElement, object>();
        private CardFrames _frames;
        private static readonly HashSet<string> Cards = new HashSet<string>
        {
            "MobileKeyboardSettingsMgr.Views.MobileSystemSettingsView",
            "MobilePerformanceMgr.Views.MobilePerformanceSummaryView",
            "MobileDisplayModeMgr.Views.MobileDisplayModeSummaryView",
            "MobileKeyboardLedMgr.Views.KeyboardSummaryView",
            "MobileLightBarLedMgr.Views.LightbarSummaryView"
        };

        static IndustrialTheme()
        {
            EventManager.RegisterClassHandler(typeof(FrameworkElement), FrameworkElement.LoadedEvent,
                new RoutedEventHandler((sender, args) =>
                {
                    if (sender is FrameworkElement element && Window.GetWindow(element) is Window owner
                        && Windows.TryGetValue(owner, out var theme)) theme.ApplyElement(element);
                }), true);
        }

        internal static ResourceDictionary CreateResources() => new ResourceDictionary
        { Source = new Uri("/IntelNucStudio.Ec;component/Themes/Industrial.xaml", UriKind.Relative) };

        internal static IndustrialTheme Install(Application application, Window window, Grid shell = null)
        {
            if (Windows.TryGetValue(window, out var current)) return current;
            var theme = new IndustrialTheme();
            var resources = CreateResources();
            theme.PrepareNativeStyles(application, window, resources);
            // Direct entries outrank the vendor's merged dictionaries. Preserve
            // the original dictionaries/converters rather than replacing them.
            foreach (var key in resources.Keys)
            {
                application.Resources[key] = resources[key];
                window.Resources[key] = resources[key];
            }
            Windows.Add(window, theme);
            if (shell != null)
            {
                theme._frames = new CardFrames(shell);
                Grid.SetRowSpan(theme._frames, Math.Max(1, shell.RowDefinitions.Count));
                Grid.SetColumnSpan(theme._frames, Math.Max(1, shell.ColumnDefinitions.Count));
                Panel.SetZIndex(theme._frames, 40); // Below EC masks/pages, above the native cards.
                shell.Children.Add(theme._frames);
                window.LayoutUpdated += (sender, args) => theme._frames.Refresh();
            }
            window.SetCurrentValue(Control.FontFamilyProperty, BodyFont);
            window.SetCurrentValue(Control.ForegroundProperty, resources["MainTextBrush"]);
            TextOptions.SetTextFormattingMode(window, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(window, TextRenderingMode.Auto);
            if (window.Content is DependencyObject root) theme.ApplyTree(root);
            return theme;
        }

        private void PrepareNativeStyles(Application application, Window window, ResourceDictionary resources)
        {
            foreach (var key in new[] { "RectangleButton", "GeneralButton", "TransparentButton", "HyperlinkButton", "RestoreButton",
                "OnOffToggle", "SliderThumbStyle", "KCSliderThumbStyle", "ComboBoxStyle", "TextInput", "TextInputNotEditable",
                "CheckboxStyle", "CustomCheckBox", "NucPerformanceCustomCheckBox", "RadioButtonControlBlue", "RadioButtonStyle",
                "NavBarText", "KcAppHeader", "NUCAppTitleText", "InfoListTitleText", "SleepWakeStatusText", "KcCardSubHeaderText",
                "KcAppTitleText", "MessagePromptText", "ColorPickerTitleText", "RadioButtonTitleText", "PoweredByNssText", "ToolTipText",
                "ColorPickerTitleTextPerformanceCpuTitle", "KcAppText", "AppTitleText", "CardTitleText", "InfoListItemText",
                "MainPageCardTitleText", "ColorPickerTitleTextPerformance", "PerformanceSubTitleText", "ToggleButtonLabelText" })
            {
                if (!(window.TryFindResource(key) is Style original)) continue;
                var style = new Style(original.TargetType, original);
                style.Setters.Add(new Setter(Control.FontFamilyProperty, BodyFont));
                if (typeof(Control).IsAssignableFrom(original.TargetType))
                    style.Setters.Add(new Setter(Control.FocusVisualStyleProperty, resources["IndustrialFocus"]));
                if (typeof(CheckBox).IsAssignableFrom(original.TargetType) || typeof(RadioButton).IsAssignableFrom(original.TargetType))
                    style.Setters.Add(new Setter(Control.ForegroundProperty, resources["MainTextBrush"]));
                if (key == "RectangleButton")
                {
                    style.Setters.Add(new Setter(Control.TemplateProperty, ((Style)resources["IndustrialButton"]).Setters.FindValue(Control.TemplateProperty)));
                    style.Setters.Add(new Setter(Control.BackgroundProperty, resources["IndustrialInputBrush"]));
                    style.Setters.Add(new Setter(Control.ForegroundProperty, resources["MainTextBrush"]));
                    style.Setters.Add(new Setter(Control.BorderBrushProperty, resources["IconBrush"]));
                    style.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(1)));
                    style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(16, 8, 16, 8)));
                }
                if (key == "OnOffToggle") style.Setters.Add(new Setter(Control.TemplateProperty, resources["IndustrialToggleTemplate"]));
                if (key == "SliderThumbStyle" || key == "KCSliderThumbStyle")
                    style.Setters.Add(new Setter(Control.TemplateProperty, ((Style)resources["IndustrialThumb"]).Setters.FindValue(Control.TemplateProperty)));
                if (key == "ComboBoxStyle")
                {
                    style.Setters.Add(new Setter(Control.TemplateProperty, resources["IndustrialComboTemplate"]));
                    style.Setters.Add(new Setter(Control.ForegroundProperty, resources["MainTextBrush"]));
                    var editable = new Trigger { Property = ComboBox.IsEditableProperty, Value = true };
                    editable.Setters.Add(new Setter(Control.TemplateProperty, resources["IndustrialComboTemplate"]));
                    style.Triggers.Add(editable);
                }
                if (key == "TextInput" || key == "TextInputNotEditable")
                {
                    style.Setters.Add(new Setter(Control.BackgroundProperty, resources["IndustrialInputBrush"]));
                    style.Setters.Add(new Setter(Control.ForegroundProperty, resources["MainTextBrush"]));
                    style.Setters.Add(new Setter(Control.BorderBrushProperty, resources["SeparatorBrush"]));
                }
                if (key == "MainPageCardTitleText")
                {
                    style.Setters.Add(new Setter(TextBlock.FontSizeProperty, 26d));
                    style.Setters.Add(new Setter(TextBlock.ForegroundProperty, resources["IconBrush"]));
                    style.Setters.Add(new Setter(TextBlock.FontWeightProperty, FontWeights.SemiBold));
                }
                if (key == "CardTitleText")
                {
                    style.Setters.Add(new Setter(TextBlock.FontSizeProperty, 48d));
                    style.Setters.Add(new Setter(TextBlock.FontWeightProperty, FontWeights.SemiBold));
                }
                _styles[original] = style;
                resources[key] = style;
            }
            foreach (var key in new[] { "BasicToggleButton", "ComboBoxTemplate", "ComboBoxEditableTemplate", "BlueDropDownTemplate" })
                if (window.TryFindResource(key) is ControlTemplate original)
                {
                    var replacement = (ControlTemplate)resources[key == "BasicToggleButton" ? "IndustrialToggleTemplate" : "IndustrialComboTemplate"];
                    _templates[original] = replacement;
                    resources[key] = replacement;
                }
            // Existing StaticResource references retain this effect instance.
            if (window.TryFindResource("CardDropShadow") is DropShadowEffect shadow && !shadow.IsFrozen)
            {
                shadow.SetCurrentValue(DropShadowEffect.BlurRadiusProperty, 8d);
                shadow.SetCurrentValue(DropShadowEffect.ShadowDepthProperty, 2d);
                shadow.SetCurrentValue(DropShadowEffect.OpacityProperty, 0.18d);
            }
        }

        private void ApplyTree(DependencyObject node)
        {
            if (node is FrameworkElement element) ApplyElement(element);
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) ApplyTree(VisualTreeHelper.GetChild(node, i));
        }

        private void ApplyElement(FrameworkElement element)
        {
            // SetCurrentValue preserves vendor bindings, commands and state. In
            // particular, never change IsEnabled/Visibility/IsChecked/Value here.
            if (element.Style != null && _styles.TryGetValue(element.Style, out var replacement))
                element.SetCurrentValue(FrameworkElement.StyleProperty, replacement);
            if (element is Control control && control.Template != null && _templates.TryGetValue(control.Template, out var template))
                control.SetCurrentValue(Control.TemplateProperty, template);
            if (element is TextBlock text && text.FontFamily.Source.StartsWith("Intel", StringComparison.OrdinalIgnoreCase))
                text.SetCurrentValue(TextBlock.FontFamilyProperty, BodyFont);
            if (_frames != null && Cards.Contains(element.GetType().FullName) && !_framed.TryGetValue(element, out var ignored))
            {
                _framed.Add(element, new object());
                _frames.Cards.Add(new WeakReference<FrameworkElement>(element));
            }
        }

        private sealed class CardFrames : FrameworkElement
        {
            private readonly Grid _root;
            private List<Rect> _bounds = new List<Rect>();
            private List<double> _headers = new List<double>();
            internal readonly List<WeakReference<FrameworkElement>> Cards = new List<WeakReference<FrameworkElement>>();
            internal CardFrames(Grid root) { _root = root; Name = "NssIndustrialCardFrames"; IsHitTestVisible = false; }
            internal void Refresh()
            {
                var bounds = new List<Rect>();
                var headers = new List<double>();
                for (var i = Cards.Count - 1; i >= 0; i--)
                {
                    if (!Cards[i].TryGetTarget(out var card)) { Cards.RemoveAt(i); continue; }
                    if (!card.IsVisible || !_root.IsAncestorOf(card) || card.ActualWidth < 2 || card.ActualHeight < 2) continue;
                    var rect = card.TransformToAncestor(_root).TransformBounds(new Rect(card.RenderSize));
                    bounds.Add(new Rect(Math.Round(rect.X, 2), Math.Round(rect.Y, 2), Math.Round(rect.Width, 2), Math.Round(rect.Height, 2)));
                    var header = FindHeader(card);
                    headers.Add(header == null ? 0 : Math.Round(header.TransformToAncestor(_root).TransformBounds(new Rect(header.RenderSize)).Bottom, 2));
                }
                var changed = bounds.Count != _bounds.Count;
                for (var i = 0; !changed && i < bounds.Count; i++) changed = bounds[i] != _bounds[i] || headers[i] != _headers[i];
                if (!changed) return;
                _bounds = bounds;
                _headers = headers;
                InvalidateVisual();
            }
            private static FrameworkElement FindHeader(DependencyObject node)
            {
                if (node is FrameworkElement element && element.GetType().FullName.StartsWith("Infrastructure.Controls.", StringComparison.Ordinal)
                    && element.GetType().Name.Contains("CardTitleBar")) return element;
                for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                {
                    var found = FindHeader(VisualTreeHelper.GetChild(node, i));
                    if (found != null) return found;
                }
                return null;
            }
            protected override void OnRender(DrawingContext context)
            {
                for (var i = 0; i < _bounds.Count; i++)
                {
                    var bounds = _bounds[i];
                    context.DrawRectangle(null, new Pen(new SolidColorBrush(Color.FromRgb(58, 84, 105)), 1),
                        new Rect(bounds.X + 0.5, bounds.Y + 0.5, bounds.Width - 1, bounds.Height - 1));
                    context.DrawLine(new Pen(new SolidColorBrush(Color.FromRgb(77, 108, 131)), 1),
                        new Point(bounds.X + 1, bounds.Y + 1), new Point(bounds.Right - 1, bounds.Y + 1));
                    if (_headers[i] > bounds.Y + 24 && _headers[i] < bounds.Bottom - 16)
                        context.DrawLine(new Pen(new SolidColorBrush(Color.FromRgb(58, 84, 105)), 1),
                            new Point(bounds.X + 24, _headers[i]), new Point(bounds.Right - 24, _headers[i]));
                }
            }
        }
    }

    internal static class ThemeSetters
    {
        internal static object FindValue(this SetterBaseCollection setters, DependencyProperty property)
        {
            foreach (var item in setters) if (item is Setter setter && setter.Property == property) return setter.Value;
            throw new InvalidOperationException("Missing industrial theme setter: " + property.Name);
        }
    }
}
