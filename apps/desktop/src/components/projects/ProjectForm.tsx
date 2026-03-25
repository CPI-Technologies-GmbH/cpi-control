import { useState, useEffect } from 'react';
import type { Project } from '@/types';
import { X } from 'lucide-react';

interface Props {
  project?: Project | null;
  onSubmit: (data: Partial<Project>) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (m) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[m] ?? m))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function ProjectForm({ project, onSubmit, onCancel, isSubmitting }: Props) {
  const [name, setName] = useState(project?.name ?? '');
  const [slug, setSlug] = useState(project?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactEmail, setContactEmail] = useState(project?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(project?.contactPhone ?? '');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (project) {
      setName(project.name);
      setSlug(project.slug ?? '');
      setContactEmail(project.contactEmail ?? '');
      setContactPhone(project.contactPhone ?? '');
      setNotes(project.notes ?? '');
    }
  }, [project]);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    else if (name.trim().length < 2) errs.name = 'Name must be at least 2 characters';
    if (!slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1)
      errs.slug = 'Only lowercase letters, numbers and hyphens allowed';
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      errs.contactEmail = 'Invalid email address';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-100">
          {project ? 'Edit Project' : 'New Project'}
        </h2>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="input"
            placeholder="Project name"
          />
          {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Slug <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            className="input font-mono text-sm"
            placeholder="project-slug"
          />
          <p className="text-xs text-gray-600 mt-1">Auto-generated from name. Used as unique identifier.</p>
          {errors.slug && <p className="text-xs text-red-400 mt-1">{errors.slug}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Contact Email</label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="input"
            placeholder="email@example.com"
          />
          {errors.contactEmail && (
            <p className="text-xs text-red-400 mt-1">{errors.contactEmail}</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Contact Phone</label>
          <input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="input"
            placeholder="+1 555-1234"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input min-h-[80px] resize-y"
            placeholder="Internal notes about this project..."
            rows={3}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={isSubmitting} className="btn-primary">
            {isSubmitting ? 'Saving...' : project ? 'Update Project' : 'Create Project'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
