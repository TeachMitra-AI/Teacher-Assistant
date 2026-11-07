import { useEffect, useState } from 'react';

// Classroom Mode's on/off choice (docs/classroom-mode.md, D16). Called above the routes so it survives leaving the chat; memory
// only, so a reload starts it OFF. Resets when the signed-in user changes: AppRoutes outlives a logout, and each question in this
// mode costs several model calls, so the choice must not carry into the next sign-in.
export function useClassroomMode(userId: string | undefined) {
  const [classroomMode, setClassroomMode] = useState(false);

  useEffect(() => {
    setClassroomMode(false);
  }, [userId]);

  return [classroomMode, setClassroomMode] as const;
}
