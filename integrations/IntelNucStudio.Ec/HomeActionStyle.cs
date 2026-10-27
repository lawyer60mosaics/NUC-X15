using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace IntelNucStudio.Ec
{
    internal static class HomeActionStyle
    {
        internal static ControlTemplate Template()
        {
            var border = new FrameworkElementFactory(typeof(Border));
            border.Name = "Surface";
            border.SetValue(Border.BackgroundProperty, Brushes.Transparent);
            border.SetValue(Border.BorderBrushProperty, Brushes.Transparent);
            border.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(3));
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            var template = new ControlTemplate(typeof(ButtonBase)) { VisualTree = border };
            foreach (var property in new[] { UIElement.IsMouseOverProperty, UIElement.IsKeyboardFocusedProperty })
            {
                var trigger = new Trigger { Property = property, Value = true };
                trigger.Setters.Add(new Setter(Border.BorderBrushProperty, Brushes.DeepSkyBlue, "Surface"));
                template.Triggers.Add(trigger);
            }
            var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
            disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.5)); template.Triggers.Add(disabled);
            return template;
        }

        internal static ImageSource Icon(bool startup, bool? enabled = null)
        {
            var group = new DrawingGroup();
            var accent = new SolidColorBrush(enabled == false ? Color.FromRgb(125, 150, 172) : Color.FromRgb(0, 175, 229));
            group.Children.Add(new GeometryDrawing(accent, null, new RectangleGeometry(new Rect(0, 0, 36, 36), 3, 3)));
            var pen = new Pen(new SolidColorBrush(Color.FromRgb(17, 33, 48)), 3);
            group.Children.Add(new GeometryDrawing(null, pen, Geometry.Parse(startup
                ? "M18,5 L18,18 M11,10 A11,11 0 1 0 25,10"
                : "M3,20 L9,20 L13,7 L19,29 L24,15 L33,15")));
            if (enabled == true)
                group.Children.Add(new GeometryDrawing(null, new Pen(Brushes.White, 2.5), Geometry.Parse("M24,29 L28,33 L35,25")));
            group.Freeze(); return new DrawingImage(group);
        }
    }
}
