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
                    // Native buttons use their own label property in the template,
                    // not Button.Content. Keep that template and its bindings.
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
                    var replacement = key == "BlueDropDownTemplate"
                        ? (ControlTemplate)((Style)resources[typeof(ComboBoxItem)]).Setters.FindValue(Control.TemplateProperty)
                        : (ControlTemplate)resources[key == "BasicToggleButton" ? "IndustrialToggleTemplate" : "IndustrialComboTemplate"];
                    // A dropdown and an item inside it have different template
                    // contracts. Validate the native target before publishing a
                    // replacement used by StaticResource/DynamicResource lookups.
                    if (!CanApplyTemplate(replacement, original.TargetType)) continue;
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
            if (element is Control control && control.Template != null && _templates.TryGetValue(control.Template, out var template)
                && CanApplyTemplate(template, control.GetType()))
                control.SetCurrentValue(Control.TemplateProperty, template);
            if (element is TextBlock text && text.FontFamily.Source.StartsWith("Intel", StringComparison.OrdinalIgnoreCase))
                text.SetCurrentValue(TextBlock.FontFamilyProperty, BodyFont);
        }

        internal static bool CanApplyTemplate(ControlTemplate template, Type controlType) => controlType != null
            && typeof(Control).IsAssignableFrom(controlType)
            && (template.TargetType == null || template.TargetType.IsAssignableFrom(controlType));

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
