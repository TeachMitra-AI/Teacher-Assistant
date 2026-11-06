// Shared roll-number ordering for every screen that lists multiple students
// (Students roster, Mark Attendance roster) — a plain numeric string compare
// would put "10" before "2", so numeric roll numbers are parsed and compared
// as numbers. Missing/non-numeric roll numbers sort after numeric ones
// (falling back to name) rather than being dropped or crashing the sort.
export interface RollNumberSortable {
  name: string;
  rollNumber?: string | null;
}

function parseRollNumber(rollNumber?: string | null): number | null {
  if (!rollNumber) return null;
  const trimmed = rollNumber.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

// "A2" before "A10", ignoring case. Hand-rolled because localeCompare's `numeric`
// option can't be relied on here: Hermes Intl support is partial, and an
// unsupported option is ignored silently.
function compareRollText(a: string, b: string): number {
  const aParts = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const bParts = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i += 1) {
    const bothDigits = /^\d/.test(aParts[i]) && /^\d/.test(bParts[i]);
    const diff = bothDigits ? Number(aParts[i]) - Number(bParts[i]) : aParts[i].localeCompare(bParts[i]);
    if (diff) return diff;
  }
  return aParts.length - bParts.length;
}

export function compareByRollNumber<T extends RollNumberSortable>(a: T, b: T): number {
  const aNum = parseRollNumber(a.rollNumber);
  const bNum = parseRollNumber(b.rollNumber);

  if (aNum !== null && bNum !== null) return aNum - bNum || a.name.localeCompare(b.name);
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;

  const aRoll = a.rollNumber?.trim();
  const bRoll = b.rollNumber?.trim();
  if (aRoll && bRoll) return compareRollText(aRoll, bRoll) || a.name.localeCompare(b.name);
  if (aRoll) return -1;
  if (bRoll) return 1;

  return a.name.localeCompare(b.name);
}

export function sortByRollNumber<T extends RollNumberSortable>(list: T[]): T[] {
  return [...list].sort(compareByRollNumber);
}
