export const DEFAULT_CLASS_DURATION_MS = 45 * 60 * 1000;

const scheduleFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function toScheduleInputValue(ms) {
  const parts = Object.fromEntries(scheduleFormatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromScheduleInputValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("יש להזין תאריך ושעה תקינים.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  // Try the offsets on either side of the date to handle Israel's DST changes.
  const offsets = new Set([-86400000, 0, 86400000].map((shift) => {
    const probe = wallTime + shift;
    const local = toScheduleInputValue(probe);
    const parts = local.match(/\d+/g).map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]) - probe;
  }));
  const candidates = [...offsets].map((offset) => wallTime - offset)
    .filter((ms) => toScheduleInputValue(ms) === value);
  if (!candidates.length) throw new Error("השעה אינה תקינה בשעון ישראל. בחרו שעה אחרת.");
  return Math.min(...candidates);
}

export function readScheduleInputs(opensInput, closesInput) {
  const opensAtMs = fromScheduleInputValue(opensInput.value);
  const closesAtMs = fromScheduleInputValue(closesInput.value);
  if (closesAtMs <= opensAtMs) throw new Error("שעת הסגירה חייבת להיות אחרי שעת הפתיחה.");
  return { opensAtMs, closesAtMs };
}

export function setupScheduleInputs(opensInput, closesInput, opensAtMs = Date.now(), closesAtMs = null) {
  let previousOpening;
  const reset = (opening = Date.now(), closing = null) => {
    opensInput.value = toScheduleInputValue(opening);
    closesInput.value = toScheduleInputValue(closing ?? opening + DEFAULT_CLASS_DURATION_MS);
    previousOpening = opensInput.value;
  };
  reset(opensAtMs, closesAtMs);
  opensInput.addEventListener("change", () => {
    if (!opensInput.value) return;
    try {
      const oldClosing = toScheduleInputValue(fromScheduleInputValue(previousOpening) + DEFAULT_CLASS_DURATION_MS);
      if (!closesInput.value || closesInput.value === oldClosing) {
        closesInput.value = toScheduleInputValue(fromScheduleInputValue(opensInput.value) + DEFAULT_CLASS_DURATION_MS);
      }
      previousOpening = opensInput.value;
    } catch {
      // Validation on save explains invalid dates or nonexistent DST times.
    }
  });
  return reset;
}
