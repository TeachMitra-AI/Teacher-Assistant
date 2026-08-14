import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Settings, LifeBuoy, LogOut } from 'lucide-react';
import { useAuth } from '../auth';
import { useOnboarding } from '../onboarding';
import { useDismissable } from '../hooks/useDismissable';
import { useHelpSupport } from './HelpSupport';
import { API_BASE, HELP_SUPPORT_ENABLED, ROLE_LABELS } from '../config';

// The avatar chip + dropdown (Getting Started / Settings / Need Help? / Sign
// out). Shared by TopBar (every page except Coach, where this menu now lives
// in the Sidebar footer instead) and Sidebar (Coach page only) — one place
// owning the account-menu state so the two call sites can never drift into
// different behaviour. `variant` only changes layout/positioning classes; the
// menu items, order and handlers are identical everywhere.

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
}

interface ProfileMenuProps {
  variant?: 'topbar' | 'sidebar';
}

export default function ProfileMenu({ variant = 'topbar' }: ProfileMenuProps) {
  const { user, logout } = useAuth();
  const { reopenIntro } = useOnboarding();
  const { openMenu: openHelp } = useHelpSupport();
  const navigate = useNavigate();
  const displayName = user ? user.displayName || user.name : '';
  const avatarEmoji = user?.preferences?.avatar;
  // Precedence: custom photo > emoji > initials. avatarUrl is a path
  // relative to the API root (see types.ts), never the image bytes
  // themselves — API_BASE is prepended the same way api() does internally.
  const avatarPhotoUrl = user?.avatarUrl ? `${API_BASE}${user.avatarUrl}` : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable(menuOpen, menuRef, () => setMenuOpen(false));

  // Tracks a photo URL that failed to load (e.g. a stale cached reference,
  // or the serving route being briefly unreachable) so the UI falls back to
  // the emoji/initials span instead of a broken-image icon. Comparing
  // against the CURRENT avatarPhotoUrl (not just a boolean) means a fresh
  // upload/removal — which always changes the URL — naturally clears a
  // stale failure without needing a separate reset effect.
  const [brokenAvatarUrl, setBrokenAvatarUrl] = useState<string | null>(null);
  const showAvatarPhoto = Boolean(avatarPhotoUrl) && avatarPhotoUrl !== brokenAvatarUrl;

  if (!user) return null;

  return (
    <div className={`profile-menu profile-menu--${variant}`} ref={menuRef}>
      <button
        className="user-chip user-chip-btn"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Account menu for ${displayName}`}
      >
        <span className={`user-avatar${avatarEmoji && !showAvatarPhoto ? ' user-avatar-emoji' : ''}`} aria-hidden="true">
          {showAvatarPhoto ? (
            <img
              src={avatarPhotoUrl as string}
              alt=""
              className="user-avatar-photo"
              onError={() => setBrokenAvatarUrl(avatarPhotoUrl)}
            />
          ) : (
            avatarEmoji || initialsOf(displayName)
          )}
        </span>
        <span className="user-meta">
          <span className="user-name">{displayName}</span>
          <span className="user-role">{ROLE_LABELS[user.role]}</span>
        </span>
      </button>

      {menuOpen && (
        <div className={`profile-dropdown profile-dropdown--${variant}`} role="menu">
          <button
            type="button"
            role="menuitem"
            className="profile-dropdown-item"
            onClick={() => { setMenuOpen(false); reopenIntro(); navigate('/'); }}
          >
            <Compass size={15} aria-hidden="true" /> Getting started
          </button>
          <button
            type="button"
            role="menuitem"
            className="profile-dropdown-item"
            onClick={() => { setMenuOpen(false); navigate('/settings'); }}
          >
            <Settings size={15} aria-hidden="true" /> Settings
          </button>
          {HELP_SUPPORT_ENABLED && (
            <button
              type="button"
              role="menuitem"
              className="profile-dropdown-item"
              onClick={() => { setMenuOpen(false); openHelp(); }}
            >
              <LifeBuoy size={15} aria-hidden="true" /> Need Help?
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="profile-dropdown-item profile-dropdown-danger"
            onClick={() => { setMenuOpen(false); logout(); }}
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
