import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customers as api } from '@/lib/api';
import ServiceList from '@/components/services/ServiceList';
import CustomerForm from './CustomerForm';
import { ArrowLeft, Edit2, Trash2, Mail, Phone, FileText } from 'lucide-react';
import { formatDate } from '@/lib/formatters';
import type { Customer } from '@/types';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => api.get(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Customer>) => api.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      window.history.back();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton w-48 h-8 rounded" />
        <div className="skeleton w-full h-32 rounded-lg" />
        <div className="skeleton w-full h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-400 mb-4">
          {error ? 'Failed to load customer' : 'Customer not found'}
        </p>
        <Link to="/customers" className="btn-secondary text-sm">
          Back to Customers
        </Link>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <Link to="/customers" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
          <ArrowLeft size={16} />
          Back to Customers
        </Link>
        <CustomerForm
          customer={customer}
          onSubmit={(data) => updateMutation.mutate(data)}
          onCancel={() => setEditing(false)}
          isSubmitting={updateMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/customers" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        <ArrowLeft size={16} />
        Back to Customers
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 mb-1">{customer.name}</h1>
          <p className="text-sm text-gray-500">Created {formatDate(customer.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="btn-secondary flex items-center gap-2 text-sm">
            <Edit2 size={14} />
            Edit
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost text-sm text-red-400 hover:text-red-300">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="btn-danger text-sm"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="card p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex items-start gap-3">
            <Mail size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm text-gray-200">{customer.contactEmail || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="text-sm text-gray-200">{customer.contactPhone || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <FileText size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Slug</p>
              <p className="text-sm text-gray-200 font-mono">{customer.slug}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Last Updated</p>
            <p className="text-sm text-gray-200">{formatDate(customer.updatedAt)}</p>
          </div>
        </div>
        {customer.notes && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{customer.notes}</p>
          </div>
        )}
      </div>

      {/* Services */}
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Services</h2>
        <ServiceList customerId={customer.id} />
      </div>
    </div>
  );
}
