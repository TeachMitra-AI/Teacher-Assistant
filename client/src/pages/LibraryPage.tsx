import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, Library as LibraryIcon } from 'lucide-react';
import TopBar from '../components/TopBar';
import OnboardingTip from '../components/OnboardingTip';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import { useOnboardingTip } from '../hooks/useOnboardingTip';
import { listResources, deleteResource } from '../lib/resources';
import { RESOURCE_TYPES, RESOURCE_TYPE_META } from '../config';
import { ApiError } from '../api';
import type { LibraryResource, ResourceType } from '../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function snippet(text: string, max = 140): string {
  const clean = text.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export default function LibraryPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const navigate = useNavigate();
  const libraryTip = useOnboardingTip('library-intro');

  const [items, setItems] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState<ResourceType | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the search box so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resources = await listResources({ type: activeType, q: debouncedSearch });
      setItems(resources);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your library.');
    } finally {
      setLoading(false);
    }
  }, [activeType, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(item: LibraryResource) {
    const confirmed = window.confirm(`Delete “${item.title}”? This cannot be undone.`);
    if (!confirmed) return;
    const previous = items;
    setItems((list) => list.filter((r) => r.id !== item.id));
    try {
      await deleteResource(item.id);
      show('Resource deleted', 'success');
    } catch (err) {
      setItems(previous); // rollback on failure
      show(err instanceof ApiError ? err.message : 'Could not delete', 'error');
    }
  }

  const isFiltering = activeType !== '' || debouncedSearch !== '';

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="library-main">
        <header className="library-header">
          <h1 className="library-title">My Library</h1>
          <p className="library-subtitle">Your saved lesson plans, activities, assessments, and resources.</p>
        </header>

        {libraryTip.visible && (
          <OnboardingTip onDismiss={libraryTip.dismiss}>
            Everything you save lands here. Open a resource to view it, then edit or print it in the Workspace.
          </OnboardingTip>
        )}

        <div className="library-controls">
          <div className="library-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or content…"
              aria-label="Search your library"
            />
          </div>

          <div className="library-filters" role="group" aria-label="Filter by type">
            <button
              type="button"
              className={`library-filter${activeType === '' ? ' active' : ''}`}
              onClick={() => setActiveType('')}
              aria-pressed={activeType === ''}
            >
              All
            </button>
            {RESOURCE_TYPES.map((t) => {
              const Icon = RESOURCE_TYPE_META[t].icon;
              return (
                <button
                  type="button"
                  key={t}
                  className={`library-filter${activeType === t ? ' active' : ''}`}
                  onClick={() => setActiveType(t)}
                  aria-pressed={activeType === t}
                >
                  <Icon size={14} aria-hidden="true" />
                  {RESOURCE_TYPE_META[t].label}
                </button>
              );
            })}
          </div>
        </div>

        {loading && (
          <div className="response-loading"><div className="spinner" /><p>Loading your library…</p></div>
        )}

        {!loading && error && <p className="auth-error">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <div className="library-empty">
            <span className="library-empty-icon" aria-hidden="true"><LibraryIcon size={26} strokeWidth={1.8} /></span>
            {isFiltering ? (
              <>
                <p className="library-empty-title">No matching resources</p>
                <p className="library-empty-hint">Try a different search or filter.</p>
              </>
            ) : (
              <>
                <p className="library-empty-title">Your library is empty</p>
                <p className="library-empty-hint">
                  Save useful AI answers from the Coach with “Save to Library” and they’ll appear here.
                </p>
                <button type="button" className="btn-primary" onClick={() => navigate('/')}>Go to Coach</button>
              </>
            )}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="library-grid">
            {items.map((item) => {
              const Icon = RESOURCE_TYPE_META[item.type].icon;
              return (
                <li key={item.id} className="library-card">
                  <button className="library-card-main" onClick={() => navigate(`/library/${item.id}`)}>
                    <span className="library-card-type">
                      <Icon size={14} aria-hidden="true" />
                      {RESOURCE_TYPE_META[item.type].label}
                    </span>
                    <span className="library-card-title">{item.title}</span>
                    {item.content && <span className="library-card-snippet">{snippet(item.content)}</span>}
                    <span className="library-card-meta">
                      {[item.grade, item.subject].filter(Boolean).join(' · ')}
                      {(item.grade || item.subject) && ' • '}
                      {formatDate(item.updatedAt)}
                    </span>
                  </button>
                  <button
                    className="library-card-delete"
                    onClick={() => handleDelete(item)}
                    aria-label={`Delete ${item.title}`}
                    title="Delete"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
