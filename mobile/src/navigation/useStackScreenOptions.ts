import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';

// Shared header theming for every stack navigator, so light/dark mode (§23:
// "verify every screen in both useColorScheme() states") applies consistently
// without each stack file repeating the same options object.
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.bg },
  };
}
