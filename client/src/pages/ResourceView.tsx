import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Pencil } from 'lucide-react';
import TopBar from '../components/TopBar';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import { formatResponse } from '../lib/format';
import { getResource, deleteResource } from '../lib/resources';
import { RESOURCE_TYPE_META } from '../config';
import { ApiError } from '../api';
import type { LibraryResource } from '../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ResourceView({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show } = useToast();

  const [resource, setResource] = useState<LibraryResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setLoading(true);
    setError('');
    getResource(id)
      .then((r) => { if (!cancelled) setResource(r); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError && err.status === 404 ? 'This resource no longer exists.' : 'Could not load this resource.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function handleDelete() {
    if (!resource) return;
    const confirmed = window.confirm(`Delete “${resource.title}”? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteResource(resource.id);
      show('Resource deleted', 'success');
      navigate('/library');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not delete', 'error');
    }
  }

  const TypeIcon = resource ? RESOURCE_TYPE_META[resource.type].icon : null;

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="resource-main">
        <button type="button" className="btn-text resource-back" onClick={() => navigate('/library')}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to Library
        </button>

        {loading && (
          <div className="response-loading"><div className="spinner" /><p>Loading…</p></div>
        )}

        {!loading && error && (
          <div className="resource-error">
            <p className="auth-error">{error}</p>
            <button type="button" className="btn-primary" onClick={() => navigate('/library')}>Back to Library</button>
          </div>
        )}

        {!loading && !error && resource && (
          <article className="resource-doc">
            <header className="resource-doc-header">
              <div className="resource-doc-heading">
                {TypeIcon && (
                  <span className="resource-doc-type">
                    <TypeIcon size={15} aria-hidden="true" />
                    {RESOURCE_TYPE_META[resource.type].label}
                  </span>
                )}
                <h1 className="resource-doc-title">{resource.title}</h1>
                <p className="resource-doc-meta">
                  {[resource.grade, resource.subject].filter(Boolean).join(' · ')}
                  {(resource.grade || resource.subject) && ' • '}
                  Updated {formatDate(resource.updatedAt)}
                </p>
              </div>
              <div className="resource-doc-actions">
                <button
                  type="button"
                  className="btn-primary resource-doc-edit"
                  onClick={() => navigate(`/library/${resource.id}/edit`)}
                >
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  className="icon-btn resource-doc-delete"
                  onClick={handleDelete}
                  aria-label="Delete this resource"
                  title="Delete"
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div
              className="response-body resource-doc-body"
              dangerouslySetInnerHTML={{ __html: formatResponse(resource.content || '') }}
            />
          </article>
        )}
      </main>
    </div>
  );
}
