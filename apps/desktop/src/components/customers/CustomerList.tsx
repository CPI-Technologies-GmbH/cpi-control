import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customers as api } from '@/lib/api';
import CustomerForm from './CustomerForm';
import { Users, Plus, Search, Mail, Phone, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '@/lib/formatters';
import type { Customer } from '@/types';

export default function CustomerList() {
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const { data: customers, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: api.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Customer>) => api.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) => api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditingCustomer(null);
      setShowForm(false);
    },
  });

  const filtered = customers?.filter((c) =>
    search ? c.name.toLowerCase().includes(search.toLowerCase()) : true
  );

  function handleSubmit(data: Partial<Customer>) {
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-gray-100">Customers</h1>
          {customers && (
            <span className="text-sm text-gray-500">({customers.length})</span>
          )}
        </div>
        <button
          onClick={() => {
            setEditingCustomer(null);
            setShowForm(true);
          }}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          New Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9 py-2 text-sm"
        />
      </div>

      {/* Form */}
      {showForm && (
        <CustomerForm
          customer={editingCustomer}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditingCustomer(null);
          }}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load customers</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 flex items-center gap-4">
              <div className="skeleton w-10 h-10 rounded-lg" />
              <div className="space-y-1.5 flex-1">
                <div className="skeleton w-32 h-4 rounded" />
                <div className="skeleton w-20 h-3 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {filtered && filtered.length === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <Users size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No customers found</p>
          <p className="text-sm text-gray-600 mt-1">
            {search ? 'Try a different search term' : 'Create your first customer to get started'}
          </p>
        </div>
      )}

      {/* List */}
      {filtered && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((customer) => (
            <Link
              key={customer.id}
              to={`/customers/${customer.id}`}
              className="card-hover p-4 flex items-center justify-between group block"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 font-semibold text-sm">
                  {customer.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">
                    {customer.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-0.5">
                    {customer.contactEmail && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Mail size={11} />
                        {customer.contactEmail}
                      </span>
                    )}
                    {customer.contactPhone && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Phone size={11} />
                        {customer.contactPhone}
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      Added {formatRelativeTime(customer.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
