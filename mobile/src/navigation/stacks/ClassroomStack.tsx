import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../types';
import { ClassListScreen } from '../../screens/classroom/ClassListScreen';
import { ClassHomeScreen } from '../../screens/classroom/ClassHomeScreen';
import { StudentsScreen } from '../../screens/classroom/StudentsScreen';
import { AttendanceScreen } from '../../screens/classroom/attendance/AttendanceScreen';
import { StudentAttendanceHistoryScreen } from '../../screens/classroom/attendance/StudentAttendanceHistoryScreen';
import { FeeStatusScreen } from '../../screens/classroom/fees/FeeStatusScreen';
import { ReportsScreen } from '../../screens/classroom/reports/ReportsScreen';
import { Header } from '../../components/Header';
import { useStackScreenOptions } from '../useStackScreenOptions';

const Stack = createNativeStackNavigator<ClassroomStackParamList>();

// Class List -> Class Home -> {Students, Attendance, Fees, Reports}, each a
// stack screen pushed from Class Home, not sibling tabs (§12). The root
// screen uses the shared web-parity Header (bell + profile avatar).
export function ClassroomStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="ClassList"
        component={ClassListScreen}
        options={{ header: () => <Header /> }}
      />
      <Stack.Screen
        name="ClassHome"
        component={ClassHomeScreen}
        options={({ route }) => ({ title: route.params.className })}
      />
      <Stack.Screen
        name="Students"
        component={StudentsScreen}
        options={({ route }) => ({ title: `${route.params.className} — Students` })}
      />
      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={({ route }) => ({ title: `${route.params.className} — Attendance` })}
      />
      <Stack.Screen
        name="StudentAttendanceHistory"
        component={StudentAttendanceHistoryScreen}
        options={({ route }) => ({ title: `${route.params.studentName} — Attendance` })}
      />
      <Stack.Screen name="Fees" options={({ route }) => ({ title: `${route.params.className} — Fees` })}>
        {({ route }) => <FeeStatusScreen classId={route.params.classId} />}
      </Stack.Screen>
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={({ route }) => ({ title: `${route.params.className} — Reports` })}
      />
    </Stack.Navigator>
  );
}
