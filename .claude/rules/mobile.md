---
paths:
  - "mobile/**"
---

# Mobile (Expo 57, React Native 0.86)

`mobile/AGENTS.md` takes precedence for everything under `mobile/`. Read the versioned Expo
docs it links to before writing code. This file adds only security points:

- Tokens live in `expo-secure-store` (`mobile/src/api/session.ts`), never AsyncStorage.
- Every `EXPO_PUBLIC_*` value ships inside the app binary. Only feature flags and public
  URLs go there, never keys or secrets.
- Role checks and feature flags in the app are UX only. The server enforces them.
- Gate from `mobile/`: `npm run lint` → `npm run typecheck` → `npm test`. A device or
  simulator run can't be done from an agent session. Report it as unverified.
