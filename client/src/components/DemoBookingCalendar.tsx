import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { formatSlotLabel, getDemoBookingSlots, type DemoBookingConfig } from '../lib/scheduleDemo';

// The date-strip + time-slot-grid picker shared by DemoBookingWidget (new booking) and ManageBookingPage (reschedule). A
// horizontally scrolling strip of the next bookable weekdays instead of a month grid: every listed date is already a working
// day (DEMO_BOOKING_WORK_DAYS), so there's no disabled state to draw and no separate desktop/mobile layout.
function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function upcomingDates(config: DemoBookingConfig): { key: string; label: string }[] {
  const dates: { key: string; label: string }[] = [];
  const today = new Date();
  for (let i = 0; dates.length < 14 && i <= config.lookaheadDays; i += 1) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const isoWeekday = d.getDay() === 0 ? 7 : d.getDay();
    if (!config.workDays.includes(isoWeekday)) continue;
    dates.push({
      key: formatDateKey(d),
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
    });
  }
  return dates;
}

interface DemoBookingCalendarProps {
  config: DemoBookingConfig;
  selectedDate: string | null;
  selectedTime: string | null;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
}

export function DemoBookingCalendar({ config, selectedDate, selectedTime, onSelectDate, onSelectTime }: DemoBookingCalendarProps) {
  const dates = useMemo(() => upcomingDates(config), [config]);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    if (!selectedDate) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlots(null);
    setSlotsLoading(true);
    getDemoBookingSlots(selectedDate)
      .then((s) => {
        if (!cancelled) setSlots(s);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  return (
    <>
      <p className="demo-widget-sub">
        {config.slotMinutes}-minute call · times shown in {config.timezone}
      </p>
      <div className="demo-date-strip" role="group" aria-label="Choose a date">
        {dates.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`demo-date-chip${selectedDate === d.key ? ' is-selected' : ''}`}
            aria-pressed={selectedDate === d.key}
            onClick={() => onSelectDate(d.key)}
          >
            <Calendar size={14} aria-hidden="true" />
            {d.label}
          </button>
        ))}
      </div>

      {selectedDate && (
        <>
          <h4 className="demo-widget-subtitle">Available times</h4>
          {slotsLoading && <p className="demo-widget-sub">Loading times…</p>}
          {!slotsLoading && slots && slots.length === 0 && (
            <p className="demo-widget-sub">No times available this day — try another date.</p>
          )}
          {!slotsLoading && slots && slots.length > 0 && (
            <div className="demo-slot-grid" role="group" aria-label="Choose a time">
              {slots.map((time) => (
                <button
                  key={time}
                  type="button"
                  className={`demo-slot-chip${selectedTime === time ? ' is-selected' : ''}`}
                  aria-pressed={selectedTime === time}
                  onClick={() => onSelectTime(time)}
                >
                  <Clock size={13} aria-hidden="true" />
                  {formatSlotLabel(time)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
