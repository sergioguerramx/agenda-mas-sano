export type AvailableDate = { iso: string; label: string; shortLabel: string; closed: boolean };
export type Slot = { time: string; label: string; available: boolean; remaining: number };
export type ReservedSlots = Record<string, number>;

const MAX_DAYS_AHEAD = 15;
const MIN_ADVANCE_MINUTES = 30;
const DEFAULT_APPOINTMENTS_PER_SLOT = 2;
const SATURDAY_EXTRA_APPOINTMENTS_PER_SLOT = 3;
const weekdays = new Intl.DateTimeFormat("es-MX", { weekday: "long" });
const dates = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" });
const schedule: Record<number, Array<{ start: string; end: string }>> = {
  1: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  2: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  4: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  5: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  6: [{ start: "10:00", end: "15:00" }]
};
export function buildAvailableDates(now: Date): AvailableDate[] {
  return Array.from({ length: MAX_DAYS_AHEAD + 1 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() + index);
    const iso = toIso(date);
    const day = cap(weekdays.format(date));
    return { iso, label: `${day} ${dates.format(date)}`, shortLabel: day, closed: !schedule[date.getDay()] };
  });
}

export function buildSlotsForDate(dateIso: string, now: Date, reservedSlots: ReservedSlots = {}): Slot[] {
  const date = new Date(`${dateIso}T00:00:00`);
  const day = date.getDay();
  return (schedule[day] ?? []).flatMap((range) => {
    const slots: Slot[] = [];
    for (let cursor = toMinutes(range.start); cursor <= toMinutes(range.end); cursor += 20) {
      const time = fromMinutes(cursor);
      const slotDate = new Date(`${dateIso}T${time}:00`);
      const reserved = reservedSlots[time] ?? 0;
      const capacity = getSlotCapacity(dateIso, time);
      const available = reserved < capacity && slotDate.getTime() - now.getTime() >= MIN_ADVANCE_MINUTES * 60000;
      slots.push({ time, label: time, available, remaining: Math.max(capacity - reserved, 0) });
    }
    return slots;
  });
}

export function getSlotCapacity(dateIso: string, time: string) {
  const date = new Date(`${dateIso}T00:00:00`);
  if (date.getDay() === 6 && isSaturdayExtraCapacitySlot(time)) return SATURDAY_EXTRA_APPOINTMENTS_PER_SLOT;
  return DEFAULT_APPOINTMENTS_PER_SLOT;
}

export function formatDisplayDate(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00`);
  return `${cap(weekdays.format(date))} ${dates.format(date)}`;
}

function isSaturdayExtraCapacitySlot(time: string) { return time.endsWith(":20"); }
function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function toMinutes(time: string) { const [h, m] = time.split(":").map(Number); return h * 60 + m; }
function fromMinutes(total: number) { return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function cap(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
