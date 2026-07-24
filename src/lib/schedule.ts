export type AvailableDate = { iso: string; label: string; shortLabel: string; closed: boolean };
export type Slot = { time: string; label: string; available: boolean; remaining: number };
export type ReservedSlots = Record<string, number>;
export type ScheduleBranchCode = "SN" | "MTY_SUR";

const MAX_DAYS_AHEAD = 15;
const MIN_ADVANCE_MINUTES = 30;
const DEFAULT_APPOINTMENTS_PER_SLOT = 2;
const SATURDAY_EXTRA_APPOINTMENTS_PER_SLOT = 3;
const TIME_ZONE = "America/Monterrey";
const weekdays = new Intl.DateTimeFormat("es-MX", { weekday: "long", timeZone: "UTC" });
const dates = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" });
const schedule: Record<number, Array<{ start: string; end: string }>> = {
  1: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  2: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  4: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  5: [{ start: "09:20", end: "13:20" }, { start: "15:00", end: "19:00" }],
  6: [{ start: "10:00", end: "15:00" }]
};

export function buildAvailableDates(now: Date): AvailableDate[] {
  const today = getMonterreyDateParts(now);
  return Array.from({ length: MAX_DAYS_AHEAD + 1 }, (_, index) => {
    const date = addDays(today.iso, index);
    const day = cap(weekdays.format(date.date));
    return { iso: date.iso, label: `${day} ${dates.format(date.date)}`, shortLabel: day, closed: !schedule[date.day] };
  });
}

export function buildSlotsForDate(
  dateIso: string,
  now: Date,
  reservedSlots: ReservedSlots = {},
  branchCode: ScheduleBranchCode = "SN"
): Slot[] {
  const day = getDayOfWeek(dateIso);
  const current = getMonterreyDateParts(now);
  return (schedule[day] ?? []).flatMap((range) => {
    const slots: Slot[] = [];
    for (let cursor = toMinutes(range.start); cursor <= toMinutes(range.end); cursor += 20) {
      const time = fromMinutes(cursor);
      const reserved = reservedSlots[time] ?? 0;
      const capacity = getSlotCapacity(dateIso, time, branchCode);
      const available = reserved < capacity && hasMinimumAdvance(dateIso, cursor, current);
      slots.push({ time, label: time, available, remaining: Math.max(capacity - reserved, 0) });
    }
    return slots;
  });
}

export function getSlotCapacity(dateIso: string, time: string, branchCode: ScheduleBranchCode = "SN") {
  if (branchCode === "MTY_SUR") return time.endsWith(":20") ? 2 : 1;
  if (getDayOfWeek(dateIso) === 6 && isSaturdayExtraCapacitySlot(time)) return SATURDAY_EXTRA_APPOINTMENTS_PER_SLOT;
  return DEFAULT_APPOINTMENTS_PER_SLOT;
}

export function formatDisplayDate(dateIso: string) {
  const date = parseDateIso(dateIso);
  return `${cap(weekdays.format(date))} ${dates.format(date)}`;
}

function hasMinimumAdvance(dateIso: string, slotMinutes: number, current: { iso: string; minutes: number }) {
  if (dateIso < current.iso) return false;
  if (dateIso > current.iso) return true;
  return slotMinutes - current.minutes >= MIN_ADVANCE_MINUTES;
}

function getMonterreyDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const iso = `${values.year}-${values.month}-${values.day}`;
  return { iso, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function addDays(dateIso: string, days: number) {
  const date = parseDateIso(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  const iso = toIso(date);
  return { iso, date, day: date.getUTCDay() };
}

function parseDateIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`);
}

function getDayOfWeek(dateIso: string) {
  return parseDateIso(dateIso).getUTCDay();
}

function isSaturdayExtraCapacitySlot(time: string) { return time.endsWith(":20"); }
function toIso(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function toMinutes(time: string) { const [h, m] = time.split(":").map(Number); return h * 60 + m; }
function fromMinutes(total: number) { return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function cap(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
