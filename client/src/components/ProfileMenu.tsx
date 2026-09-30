import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Compass, Settings, LifeBuoy, Info, ChevronRight, FileText, ShieldCheck, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '../auth';
import { useOnboarding } from '../onboarding';
import { useDismissable } from '../hooks/useDismissable';
import { useHelpSupport } from './HelpSupport';
import { API_BASE, HELP_SUPPORT_ENABLED, ROLE_LABELS } from '../config';

// The avatar chip + dropdown (Getting Started / Settings / Need Help? / Sign out), shared by TopBar (every page except
// Coach) and Sidebar (Coach only) so the account-menu state has one owner. `variant` only changes layout classes.

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
}

interface SubmenuPosition {
  top?: number;
  bottom?: number;
  left: number;
}

// Only decides which way the "Learn more" flyout opens, so an approximation is enough (see ShareMenu).
const SUBMENU_APPROX_HEIGHT = 100;
const SUBMENU_APPROX_WIDTH = 190;
const SUBMENU_GAP = 6;
const SUBMENU_EDGE_MARGIN = 8;

function computeSubmenuPosition(anchorEl: HTMLElement): SubmenuPosition {
  const rect = anchorEl.getBoundingClientRect();
  const position: Partial<SubmenuPosition> = {};
  // Opens upward by default, like the account menu, and falls back downward only when there's no room above.
  if (rect.bottom < SUBMENU_APPROX_HEIGHT) {
    position.top = rect.top;
  } else {
    position.bottom = window.innerHeight - rect.bottom;
  }

  // Opens on whichever side has more room, then clamps to the viewport. Comparing space (not just "does the preferred side
  // fit") matters on the sidebar variant: its "Learn more" row spans nearly the drawer width, so flipping left lands the
  // flyout on top of the drawer's own list, while the space on its right is outside the drawer's content column.
  const spaceRight = window.innerWidth - rect.right;
  const spaceLeft = rect.left;
  const desiredLeft = spaceRight >= spaceLeft ? rect.right + SUBMENU_GAP : rect.left - SUBMENU_GAP - SUBMENU_APPROX_WIDTH;
  position.left = Math.min(
    Math.max(desiredLeft, SUBMENU_EDGE_MARGIN),
    window.innerWidth - SUBMENU_APPROX_WIDTH - SUBMENU_EDGE_MARGIN,
  );

  return position as SubmenuPosition;
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
  // Precedence: custom photo > emoji > initials. avatarUrl is a path relative to the API root (types.ts); API_BASE is prepended as api() does.
  const avatarPhotoUrl = user?.avatarUrl ? `${API_BASE}${user.avatarUrl}` : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // "Learn more" flyout (Terms / Privacy), portalled to document.body (index.css .profile-submenu) because the sidebar
  // variant's dropdown sits inside `.sidebar`, whose `overflow: hidden` would clip it. `submenuPanelRef` is in the outer
  // useDismissable call so a click in the portalled panel isn't treated as outside.
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);
  const [submenuPosition, setSubmenuPosition] = useState<SubmenuPosition | null>(null);
  const submenuTriggerRef = useRef<HTMLButtonElement>(null);
  const submenuPanelRef = useRef<HTMLDivElement>(null);
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismissRefs = useMemo(() => [menuRef, submenuPanelRef], []);
  useDismissable(menuOpen, dismissRefs, () => { setMenuOpen(false); setLearnMoreOpen(false); });

  useLayoutEffect(() => {
    if (!learnMoreOpen || !submenuTriggerRef.current) {
      setSubmenuPosition(null);
      return;
    }
    setSubmenuPosition(computeSubmenuPosition(submenuTriggerRef.current));
    function close() { setLearnMoreOpen(false); }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [learnMoreOpen]);

  // Once the panel is portalled there's a small gap between subtrees, so closing on mouseleave would drop the flyout
  // before the pointer reaches it. A short delay, cancelled by re-entering the trigger or panel, fixes that.
  function openSubmenu() {
    clearTimeout(submenuCloseTimer.current);
    setLearnMoreOpen(true);
  }
  function closeSubmenuSoon() {
    submenuCloseTimer.current = setTimeout(() => setLearnMoreOpen(false), 200);
  }

  // Tracks a photo URL that failed to load so the UI falls back to emoji/initials instead of a broken image. Comparing
  // against the current URL (not a boolean) means a new upload or removal clears a stale failure with no reset effect.
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
          <div
            className="profile-dropdown-submenu-wrap"
            onMouseEnter={openSubmenu}
            onMouseLeave={closeSubmenuSoon}
          >
            <button
              ref={submenuTriggerRef}
              type="button"
              role="menuitem"
              className="profile-dropdown-item"
              aria-haspopup="true"
              aria-expanded={learnMoreOpen}
              // Not a toggle: a touch tap or click fires a hover-in first, which already opens the flyout, so toggling would
              // flip it straight closed. Opening explicitly also serves keyboard Enter/Space. It closes on hover-away,
              // outside click, or picking a link.
              onClick={openSubmenu}
            >
              <Info size={15} aria-hidden="true" /> Learn more
              <ChevronRight size={14} className="profile-dropdown-caret" aria-hidden="true" />
            </button>
            {learnMoreOpen && submenuPosition && createPortal(
              <div
                ref={submenuPanelRef}
                className="profile-submenu"
                role="menu"
                onMouseEnter={openSubmenu}
                onMouseLeave={closeSubmenuSoon}
                style={{
                  top: submenuPosition.top ?? 'auto',
                  bottom: submenuPosition.bottom ?? 'auto',
                  left: submenuPosition.left,
                }}
              >
                {/* Real anchors with target="_blank", not window.open(): mobile browsers block a scripted window.open a
                    state update or two removed from the tap, but not a genuine link click. */}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener"
                  role="menuitem"
                  className="profile-dropdown-item"
                  onClick={() => { setMenuOpen(false); setLearnMoreOpen(false); }}
                >
                  <FileText size={15} aria-hidden="true" /> Terms of Service
                  <ExternalLink size={13} className="profile-dropdown-caret" aria-hidden="true" />
                </a>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener"
                  role="menuitem"
                  className="profile-dropdown-item"
                  onClick={() => { setMenuOpen(false); setLearnMoreOpen(false); }}
                >
                  <ShieldCheck size={15} aria-hidden="true" /> Privacy Policy
                  <ExternalLink size={13} className="profile-dropdown-caret" aria-hidden="true" />
                </a>
              </div>,
              document.body
            )}
          </div>
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
