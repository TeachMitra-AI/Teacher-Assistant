// Roll-number rules for Classroom Management students. rollNumber is free text, so neither a database ORDER BY nor a
// plain unique index on it gives the right answer ("10" sorts before "2"; "01" and "1" look different).

/**
 * What the unique index on (classId, rollNumberKey) compares: "01" and "1" match, as do "a1" and "A1". Null for a blank
 * roll number, which never conflicts. prisma/migrations/*_student_roll_number_key backfills with this same rule.
 * @param {string|null|undefined} rollNumber
 * @returns {string|null}
 */
function rollNumberKey(rollNumber) {
  const trimmed = rollNumber?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed.replace(/^0+(?=\d)/, '');
  return trimmed.toLowerCase();
}

function parseRollNumber(rollNumber) {
  const trimmed = rollNumber?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

// "A2" before "A10", ignoring case. Hand-rolled to match the mobile copy, where localeCompare's `numeric` option can't
// be relied on: Hermes Intl support is partial, and an unsupported option is ignored silently.
function compareRollText(a, b) {
  const aParts = a.toLowerCase().match(/\d+|\D+/g);
  const bParts = b.toLowerCase().match(/\d+|\D+/g);
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i += 1) {
    const bothDigits = /^\d/.test(aParts[i]) && /^\d/.test(bParts[i]);
    const diff = bothDigits ? Number(aParts[i]) - Number(bParts[i]) : aParts[i].localeCompare(bParts[i]);
    if (diff) return diff;
  }
  return aParts.length - bParts.length;
}

/**
 * Numeric roll numbers ascending, then other roll numbers, then students with none; ties break on name. Same order as
 * mobile/src/lib/students.ts and client/src/lib/students.ts.
 * @param {{name: string, rollNumber?: string|null}} a
 * @param {{name: string, rollNumber?: string|null}} b
 * @returns {number}
 */
function compareByRollNumber(a, b) {
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

module.exports = { rollNumberKey, compareByRollNumber };
