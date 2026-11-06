// Roster order, matching server/src/lib/classroomStudents.js and mobile/src/lib/students.ts: numeric roll numbers
// ascending ("2" before "10"), then other roll numbers, then students with none; ties break on name.
interface RollNumberSortable {
  name: string;
  rollNumber?: string | null;
}

function parseRollNumber(rollNumber?: string | null): number | null {
  const trimmed = rollNumber?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

// "A2" before "A10", ignoring case. Hand-rolled to match the mobile copy, where localeCompare's `numeric` option can't
// be relied on: Hermes Intl support is partial, and an unsupported option is ignored silently.
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

function compareByRollNumber<T extends RollNumberSortable>(a: T, b: T): number {
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
