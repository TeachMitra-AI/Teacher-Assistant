import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Sparkles, Library, GraduationCap, FileQuestion, MoreHorizontal } from 'lucide-react-native';
import type { MainTabParamList } from './types';
import { CoachStack } from './stacks/CoachStack';
import { ClassroomStack } from './stacks/ClassroomStack';
import { LibraryStack } from './stacks/LibraryStack';
import { GeneratorStack } from './stacks/GeneratorStack';
import { MoreStack } from './stacks/MoreStack';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Bottom tab bar, 5 tabs, plus per-feature stack navigators nested inside
// each tab (§10) — NOT a copy of the web's 4-item BottomNav.tsx. "More"
// (Notifications/Settings/Sessions/Admin*/Help & Support) is a deliberate
// improvement over the web nav's gap (§10): a full-screen native app has no
// always-visible top bar to fall back on for those destinations. Icons are
// the same lucide set the web nav already uses (§22) — Sparkles/Library/
// GraduationCap/FileQuestion match BottomNav.tsx exactly; MoreHorizontal is
// new, since "More" has no web equivalent.
export function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="CoachTab"
        component={CoachStack}
        options={{ title: 'Coach', tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} /> }}
      />
      <Tab.Screen
        name="ClassroomTab"
        component={ClassroomStack}
        options={{ title: 'Classroom', tabBarIcon: ({ color, size }) => <GraduationCap color={color} size={size} /> }}
      />
      <Tab.Screen
        name="LibraryTab"
        component={LibraryStack}
        options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Library color={color} size={size} /> }}
      />
      <Tab.Screen
        name="GeneratorTab"
        component={GeneratorStack}
        options={{ title: 'Generator', tabBarIcon: ({ color, size }) => <FileQuestion color={color} size={size} /> }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStack}
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
