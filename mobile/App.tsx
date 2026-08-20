import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { MockRoleProvider } from './src/auth/MockRoleContext';
import { RootNavigator } from './src/navigation/RootNavigator';

function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MockRoleProvider>
          <RootNavigator />
          <ThemedStatusBar />
        </MockRoleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
