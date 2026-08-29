import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Sparkles, Library, GraduationCap, FileQuestion } from 'lucide-react-native';
import type { MainTabParamList } from './types';
import { CoachStack } from './stacks/CoachStack';
import { LibraryStack } from './stacks/LibraryStack';
import { ClassroomStack } from './stacks/ClassroomStack';
import { GeneratorStack } from './stacks/GeneratorStack';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Every other tab (Coach/Library/Classroom) keeps its nested stack mounted
// — with its state — across tab switches; that's normal React Navigation
// behavior, and those screens rely on it (Coach's in-progress draft,
// Library/Classroom scroll position, etc). Generator is the deliberate
// exception: a half-filled request form, or an unsaved generated result on
// GeneratorResult, left behind when the user switches tabs should not still
// be there next time they open Generator. Unmounting the whole nested stack
// on blur (rather than trying to reset its state/navigation position in
// place) guarantees a genuinely fresh form every time, and — since React
// just removes the tree rather than dispatching a navigation action —
// discards an in-review GeneratorResult without its own "Discard this
// result?" prompt interrupting the tab switch.
function GeneratorTabScreen() {
  const isFocused = useIsFocused();
  return isFocused ? <GeneratorStack /> : null;
}

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
        component={GeneratorTabScreen}
        options={{ title: 'Generator', tabBarIcon: ({ color, size }) => <FileQuestion color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}
