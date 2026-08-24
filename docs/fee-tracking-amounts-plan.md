# Fee Tracking with Amounts — Plan

**Branch:** `feature/fee-tracking-amounts`
**Status:** All done (2026-08-22).

## Why we did this

Before, the Fees tab only said "Paid" or "Pending" for each student. No
money numbers anywhere. Now it tracks real ₹ amounts, so you can see how
much was actually collected and how much is still missing.

## The 6 things we added

1. **Fee amount for each class** — e.g. "Class 5-A pays ₹1000 every month."
   Set once per class, on the Classes tab. Can be changed later anytime.

2. **Amount paid per student** — on the Fees tab, you type in exactly how
   much each student paid, instead of just ticking Paid/Pending.

3. **A third status: "Partial"** — if a student pays less than the full
   amount, it now correctly shows "Partial" instead of wrongly showing
   "Paid" or "Pending."

4. **A dashboard on the Reports tab** — shows total money expected, total
   collected, total still pending, and exactly which students still owe
   money and how much.

5. **A reminder notification** — the bell icon at the top now tells you
   things like "3 students still pending fees this month."

6. **Money amounts in the downloaded file** — the download (on the Reports
   tab) now has real ₹ columns, not just Paid/Pending words. It's a real
   Excel file (not CSV), so the Status column is even colored
   green/yellow/red, matching the app exactly.

## Things we did NOT add (on purpose, to keep it simple)

Due dates, late fees, payment receipts, different fees for different
students (discounts). Easy to add later if actually needed.

## How it was built (3 steps, tested one at a time)

**Step 1 — the basics**
Added the class fee amount, the amount-paid box, and the Partial status.
Needed one small, safe database change (asked for permission first).

**Step 2 — the dashboard**
Built the Reports tab so it shows totals and a "who still owes money" list,
just by reading the numbers already saved in Fees — nothing new to type in.

**Step 3 — the extras**
Added the reminder notification (shows up in the bell) and added real ₹
amounts to the downloaded file, plus a working download button on the
Reports tab (there wasn't one before, and it makes more sense there than on
the Fees tab).

**Follow-up fixes (after watching it live)**
- The colored badge (green/yellow/red) on each student's row only worked
  for "Partial" by accident — "Paid" and "Pending" were silently uncolored
  due to a leftover mismatch from copying the Attendance tab's styling.
  Fixed: Paid is now green, Partial yellow, Pending red, on both the Fees
  tab and the Reports tab's "who owes money" list.
- Moved the download button from the Fees tab to the Reports tab, since
  Reports is where a teacher would naturally look for something to export.
- Switched the downloaded file from CSV to a real Excel (.xlsx) file. A
  plain CSV file cannot hold color at all — that's not something we could
  code around, it's just what CSV is (bare text, no formatting). So to make
  the downloaded file show the same green/yellow/red coloring as the app,
  it had to become an actual spreadsheet file instead. Verified by opening
  the real downloaded file and confirming the colors are exactly right.

## What we tested

Ran the app's full automatic test suite (backend and frontend, both pass),
and also did a real hands-on test in the browser: created a class with a
₹1000 fee, added 5 students, marked attendance, paid some fees fully, some
partially, left one unpaid — and watched the Reports tab and the
notification bell update correctly to match.

## One unrelated pre-existing issue

There's one already-broken test in the app (about notifications on saved
resources) that has nothing to do with this fee work — double-checked that
this branch never touched that code, so it's a separate, older problem, not
something this work caused.
