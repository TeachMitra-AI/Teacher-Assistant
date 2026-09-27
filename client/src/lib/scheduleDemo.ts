// Typed client for Schedule a Call (public demo-booking flow). Thin wrappers
// over api(), same shape as lib/adminSupport.ts. Every route here is public
// (no auth) — api()'s default Authorization header is harmless for a
// signed-out visitor (no token exists), and no caller here needs to disable
// it.
import { api } from '../api';

export type DemoBookingRole = 'school_admin' | 'org_leadership' | 'other';

export interface DemoBookingConfig {
  timezone: string;
  workDays: number[];
  startTime: string;
  endTime: string;
  slotMinutes: number;
  lookaheadDays: number;
}

export interface DemoBooking {
  id: string;
  name: string;
  organization: string;
  role: DemoBookingRole;
  date: string;
  startTime: string;
  dateLabel: string;
  timeLabel: string;
  durationMinutes: number;
  status: 'confirmed' | 'cancelled';
}

export interface DemoBookingInput {
  name: string;
  email: string;
  organization: string;
  role: DemoBookingRole;
  phone?: string;
  notes?: string;
  date: string;
  startTime: string;
}

export async function getDemoBookingConfig(): Promise<DemoBookingConfig> {
  return api<DemoBookingConfig>('/schedule-demo/config', { auth: false });
}

export async function getDemoBookingSlots(date: string): Promise<string[]> {
  const data = await api<{ date: string; slots: string[] }>(
    `/schedule-demo/slots?date=${encodeURIComponent(date)}`,
    { auth: false }
  );
  return data.slots;
}

export async function createDemoBooking(input: DemoBookingInput): Promise<{ booking: DemoBooking; manageUrl: string }> {
  return api<{ booking: DemoBooking; manageUrl: string }>('/schedule-demo/bookings', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

export async function getDemoBooking(id: string, token: string): Promise<DemoBooking> {
  const data = await api<{ booking: DemoBooking }>(
    `/schedule-demo/bookings/${id}?token=${encodeURIComponent(token)}`,
    { auth: false }
  );
  return data.booking;
}

export async function rescheduleDemoBooking(
  id: string,
  token: string,
  input: { date: string; startTime: string }
): Promise<DemoBooking> {
  const data = await api<{ booking: DemoBooking }>(`/schedule-demo/bookings/${id}?token=${encodeURIComponent(token)}`, {
    method: 'PATCH',
    body: input,
    auth: false,
  });
  return data.booking;
}

export async function cancelDemoBooking(id: string, token: string): Promise<DemoBooking> {
  const data = await api<{ booking: DemoBooking }>(
    `/schedule-demo/bookings/${id}/cancel?token=${encodeURIComponent(token)}`,
    { method: 'POST', auth: false }
  );
  return data.booking;
}

// "14:00" -> "2:00 PM" — shared by DemoBookingCalendar and DemoBookingWidget.
// Lives here (a plain module, not a component file) rather than beside
// either component, so both keep the "only exports a component" shape
// react-refresh's fast-refresh lint rule expects.
export function formatSlotLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}
