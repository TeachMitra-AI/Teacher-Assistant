import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Sparkles, Library, GraduationCap, FileQuestion } from 'lucide-react-native';
import type { MainTabParamList } from './types';
import { CoachStack } from './stacks/CoachStack';
import { LibraryStack } from './stacks/LibraryStack';
import { ClassroomStack } from './stacks/ClassroomStack';
import { GeneratorStack } from './stacks/GeneratorStack';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator<MainTabParamList>();

// 4 tabs, in the same order as the web's client/src/components/BottomNav.tsx
// (Coach, Library, Classroom, Generator) — web-UI-parity pass. The previous
// 5th "More" tab (Notifications/Settings/Sessions/Admin/HelpSupport) has
// been removed: the web has no such tab, reaching those destinations
// instead through the header's notification bell and profile avatar
// (Header.tsx, AppNavigator.tsx) which this app now mirrors. Icons are the
// same lucide set BottomNav.tsx already uses.
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
        name="LibraryTab"
        component={LibraryStack}
        options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Library color={color} size={size} /> }}
      />
      <Tab.Screen
        name="ClassroomTab"
        component={ClassroomStack}
        options={{ title: 'Classroom', tabBarIcon: ({ color, size }) => <GraduationCap color={color} size={size} /> }}
      />
      <Tab.Screen
        name="GeneratorTab"
        component={GeneratorStack}
        options={{ title: 'Generator', tabBarIcon: ({ color, size }) => <FileQuestion color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
