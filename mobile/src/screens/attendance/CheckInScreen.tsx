// Native port of client/src/components/attendance/CheckInTab.tsx — GPS read
// via expo-location instead of the browser Geolocation API, everything else
// (states, offline queue, closing-time reminder) ported 1:1.
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { AlertTriangle, CloudOff, CalendarOff, Bell } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import {
  checkIn, checkOut, getTodayAttendance, getSchoolConfig, type AttendanceEvidenceInput,
} from '../../api/teacherAttendanceApi';
import {
  getLocationWithRetry, requestCurrentPosition, distanceMeters, LocationUnavailableError, LocationPermissionDeniedError,
} from '../../lib/geolocation';
import { getOrCreateDeviceId } from '../../lib/deviceId';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatAttendanceTime, formatDuration, formatDistance } from '../../lib/teacherAttendanceLabels';
import { todayDateString } from '../../lib/classroomDate';
import {
  enqueueAction, getQueuedAction, subscribeToQueue, attemptSync, startAutoSync, retryQueuedAction,
  type QueuedAttendanceAction,
} from '../../lib/attendanceOfflineQueue';
import type { TeacherAttendanceDto, NonWorkingDayInfo, SchoolAttendanceConfigDto } from '../../types';

export function CheckInScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TeacherAttendanceDto | null>(null);
  const [working, setWorking] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [error, setError] = useState('');
  const [nonWorkingDay, setNonWorkingDay] = useState<NonWorkingDayInfo | null>(null);
  const [queuedAction, setQueuedAction] = useState<QueuedAttendanceAction | null>(null);

  // Live "how far am I from school" preview, shown BEFORE the button is
  // tapped — a nudge, not the real security check (the server always
  // recomputes independently). Only a KNOWN "too far" reading disables the
  // button; anything unknown (no config, location failed, offline) leaves it
  // enabled and falls back to the on-tap flow's own clear error.
  const [schoolConfig, setSchoolConfig] = useState<SchoolAttendanceConfigDto | null>(null);
  const [liveDistanceMeters, setLiveDistanceMeters] = useState<number | null>(null);
  const [checkingDistance, setCheckingDistance] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getTodayAttendance();
      setToday(result.attendance);
      setNonWorkingDay(result.nonWorkingDay);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load today's attendance.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const refreshQueuedAction = useCallback(() => {
    if (!user) return;
    const date = todayDateString();
    (async () => {
      const queued = (await getQueuedAction(user.id, date, 'check-in')) ?? (await getQueuedAction(user.id, date, 'check-out'));
      setQueuedAction((prev) => {
        if (prev && !queued) void load();
        return queued;
      });
    })();
  }, [user, load]);

  useEffect(() => {
    refreshQueuedAction();
    return subscribeToQueue(refreshQueuedAction);
  }, [refreshQueuedAction]);

  useEffect(() => {
    if (!user) return;
    const stopAutoSync = startAutoSync(() => user.id);
    void attemptSync(user.id);
    return stopAutoSync;
  }, [user]);

  useEffect(() => {
    getSchoolConfig().then(setSchoolConfig).catch(() => {}); // silent — falls back to no distance check
  }, []);

  // Re-fetches the school's config fresh every time, rather than reusing the
  // captured state — a Principal can change the geofence location in
  // Settings while a teacher already has this screen open.
  const checkDistance = useCallback(async () => {
    setCheckingDistance(true);
    try {
      const [position, freshConfig] = await Promise.all([
        getLocationWithRetry((timeoutMs) => requestCurrentPosition(timeoutMs)),
        getSchoolConfig(),
      ]);
      if (!freshConfig) {
        setLiveDistanceMeters(null);
        return;
      }
      setSchoolConfig(freshConfig);
      setLiveDistanceMeters(distanceMeters(position.lat, position.lon, freshConfig.geofenceLat, freshConfig.geofenceLon));
    } catch {
      setLiveDistanceMeters(null); // unknown, not "too far" — never blocks the button by itself
    } finally {
      setCheckingDistance(false);
    }
  }, []);

  const hasSchoolConfig = schoolConfig !== null;
  useEffect(() => {
    if (!hasSchoolConfig || loading) return;
    const needsCheckIn = !today?.checkInAt && !nonWorkingDay;
    const needsCheckOut = Boolean(today?.checkInAt) && !today?.checkOutAt;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsCheckIn || needsCheckOut) void checkDistance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSchoolConfig, loading, today?.checkInAt, today?.checkOutAt, nonWorkingDay]);

  const tooFarToActNow = Boolean(schoolConfig && liveDistanceMeters !== null && liveDistanceMeters > schoolConfig.geofenceRadiusMeters);

  // Calm, inline "don't forget to check out" nudge — the same 15-before /
  // 30-after window the server's own reminder sweep uses.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const closingSoon = (() => {
    if (!schoolConfig || !today?.checkInAt || today.checkOutAt) return false;
    const [closeH, closeM] = schoolConfig.closeTime.split(':').map(Number);
    const closeMinutes = closeH * 60 + closeM;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return (
      nowMinutes >= closeMinutes - schoolConfig.reminderMinutesBeforeClose &&
      nowMinutes <= closeMinutes + schoolConfig.reminderMinutesAfterClose
    );
  })();

  async function performAction(kind: 'check-in' | 'check-out') {
    setWorking(true);
    setError('');
    setLocationStatus('Getting your location…');

    let evidence: AttendanceEvidenceInput;
    try {
      const position = await getLocationWithRetry((timeoutMs) => requestCurrentPosition(timeoutMs));
      evidence = { ...position, deviceId: await getOrCreateDeviceId() };
    } catch (err) {
      if (err instanceof LocationPermissionDeniedError) {
        setError(err.message);
      } else if (err instanceof LocationUnavailableError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setWorking(false);
      setLocationStatus('');
      return;
    }

    setLocationStatus(kind === 'check-in' ? 'Checking in…' : 'Checking out…');
    try {
      const result = kind === 'check-in' ? await checkIn(evidence) : await checkOut(evidence);
      setToday(result.attendance);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Queued rather than shown as a hard error — evidence isn't lost, it
        // syncs automatically the moment the connection comes back.
        if (user) {
          await enqueueAction(user.id, todayDateString(), kind, evidence);
        } else {
          setError("No internet connection right now. Please try again once you're back online.");
        }
      } else if (err instanceof ApiError) {
        setError(err.message);
        getTodayAttendance().then((result) => setToday(result.attendance)).catch(() => {});
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setWorking(false);
      setLocationStatus('');
    }
  }

  function renderDistanceCard() {
    if (!schoolConfig) return null;
    if (liveDistanceMeters === null) {
      return checkingDistance ? (
        <View style={[styles.distanceCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <ActivityIndicator size="small" color={colors.text} />
          <ThemedText variant="muted" style={styles.distanceCaption}>Checking your distance from school…</ThemedText>
        </View>
      ) : null;
    }
    return (
      <View
        style={[
          styles.distanceCard,
          { backgroundColor: colors.surface2, borderColor: tooFarToActNow ? colors.semantic.danger.border : colors.border },
        ]}
      >
        <ThemedText variant="muted" style={styles.distanceLabel}>Distance to school</ThemedText>
        <ThemedText style={styles.distanceValue}>{formatDistance(liveDistanceMeters)}</ThemedText>
        <ThemedText
          variant="muted"
          style={[styles.distanceCaption, tooFarToActNow && { color: colors.semantic.danger.text }]}
        >
          {tooFarToActNow ? `need to be within ${formatDistance(schoolConfig.geofenceRadiusMeters)}` : 'within range'}
        </ThemedText>
        <Button title="Refresh" variant="text" onPress={checkDistance} disabled={checkingDistance} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {!!error && (
        <View style={[styles.banner, { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border }]}>
          <AlertTriangle size={16} color={colors.semantic.danger.text} />
          <ThemedText style={{ color: colors.semantic.danger.text, flex: 1 }}>{error}</ThemedText>
        </View>
      )}

      {queuedAction && (
        <View style={[styles.banner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <CloudOff size={16} color={colors.textMuted} />
          <ThemedText variant="muted" style={{ flex: 1 }}>
            Your {queuedAction.kind === 'check-in' ? 'check-in' : 'check-out'} is saved and will sync automatically
            once you&apos;re back online.
          </ThemedText>
          <Button
            title="Retry now"
            variant="text"
            onPress={() => user && retryQueuedAction(queuedAction.key, user.id)}
          />
        </View>
      )}

      <Card style={styles.card}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.orange} />
          </View>
        ) : nonWorkingDay && !today?.checkInAt ? (
          <View style={styles.stateRow}>
            <CalendarOff size={16} color={colors.textMuted} />
            <ThemedText variant="muted">{nonWorkingDay.message}</ThemedText>
          </View>
        ) : !today?.checkInAt ? (
          <>
            <ThemedText style={styles.stateTitle}>Not checked in yet</ThemedText>
            {renderDistanceCard()}
            <Button
              title={working ? (locationStatus || 'Checking in…') : 'Check In'}
              onPress={() => performAction('check-in')}
              disabled={working || tooFarToActNow}
              loading={working}
              style={styles.actionBtn}
            />
            {tooFarToActNow && (
              <ThemedText variant="muted" style={styles.hint}>
                Move closer to school — the button turns on automatically within range.
              </ThemedText>
            )}
          </>
        ) : !today.checkOutAt ? (
          <>
            <View style={styles.checkedBlock}>
              <ThemedText variant="muted" style={styles.checkedLabel}>Checked in</ThemedText>
              <ThemedText style={styles.checkedTime}>{formatAttendanceTime(today.checkInAt)}</ThemedText>
              <ThemedText variant="muted" style={styles.checkedSub}>
                {today.lateMinutes ? `${formatDuration(today.lateMinutes)} late` : 'On time'}
              </ThemedText>
            </View>
            {closingSoon && (
              <View style={[styles.reminderBanner, { backgroundColor: colors.semantic.warning.bg, borderColor: colors.semantic.warning.border }]}>
                <Bell size={14} color={colors.semantic.warning.text} />
                <ThemedText style={{ color: colors.semantic.warning.text, flex: 1 }}>
                  Don&apos;t forget to check out before school closes.
                </ThemedText>
              </View>
            )}
            {renderDistanceCard()}
            <Button
              title={working ? (locationStatus || 'Checking out…') : 'Check Out'}
              onPress={() => performAction('check-out')}
              disabled={working || tooFarToActNow}
              loading={working}
              style={styles.actionBtn}
            />
            {tooFarToActNow && (
              <ThemedText variant="muted" style={styles.hint}>
                Move closer to school — the button turns on automatically within range.
              </ThemedText>
            )}
          </>
        ) : (
          <View style={[styles.daySummary, { backgroundColor: today.status === 'half_day' ? colors.semantic.warning.bg : colors.semantic.success.bg }]}>
            <View style={styles.daySummaryTimes}>
              <View style={styles.daySummaryCol}>
                <ThemedText variant="muted" style={styles.checkedLabel}>Checked in</ThemedText>
                <ThemedText style={styles.checkedTime}>{formatAttendanceTime(today.checkInAt)}</ThemedText>
                <ThemedText variant="muted" style={styles.checkedSub}>{today.lateMinutes ? `${formatDuration(today.lateMinutes)} late` : 'On time'}</ThemedText>
              </View>
              <View style={[styles.daySummaryDivider, { backgroundColor: colors.border }]} />
              <View style={styles.daySummaryCol}>
                <ThemedText variant="muted" style={styles.checkedLabel}>Checked out</ThemedText>
                <ThemedText style={styles.checkedTime}>{formatAttendanceTime(today.checkOutAt)}</ThemedText>
                <ThemedText variant="muted" style={styles.checkedSub}>
                  {today.earlyDepartureMinutes ? `${formatDuration(today.earlyDepartureMinutes)} early` : 'On time'}
                </ThemedText>
              </View>
            </View>
            <View style={[styles.daySummaryFooter, { borderTopColor: colors.border }]}>
              <ThemedText style={styles.daySummaryStatus}>{TEACHER_ATTENDANCE_STATUS_LABEL[today.status]}</ThemedText>
              {typeof today.workingMinutes === 'number' && (
                <ThemedText variant="muted" style={styles.daySummaryWorked}>
                  Worked {formatDuration(today.workingMinutes)}
                  {typeof today.shortfallMinutes === 'number' && today.shortfallMinutes > 0
                    ? ` — ${formatDuration(today.shortfallMinutes)} short of a full day`
                    : ''}
                </ThemedText>
              )}
            </View>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stateTitle: { fontSize: 15, fontWeight: '600' },
  distanceCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', gap: 2 },
  distanceLabel: { fontSize: 12 },
  distanceValue: { fontSize: 22, fontWeight: '700' },
  distanceCaption: { fontSize: 12 },
  actionBtn: { marginTop: spacing.xs },
  hint: { fontSize: 12, textAlign: 'center' },
  checkedBlock: { alignItems: 'center', gap: 2 },
  checkedLabel: { fontSize: 12 },
  checkedTime: { fontSize: 24, fontWeight: '700' },
  checkedSub: { fontSize: 12 },
  reminderBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  daySummary: { borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm },
  daySummaryTimes: { flexDirection: 'row', alignItems: 'center' },
  daySummaryCol: { flex: 1, alignItems: 'center', gap: 2 },
  daySummaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  daySummaryFooter: { alignItems: 'center', gap: 2, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  daySummaryStatus: { fontWeight: '700' },
  daySummaryWorked: { fontSize: 12 },
});
