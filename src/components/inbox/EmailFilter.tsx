import React from 'react';
import { Search, Filter, X, Calendar } from 'lucide-react';
import { useInbox } from '../../contexts/InboxContext';

interface EmailFilterProps {
  selectedStore: string;
  setSelectedStore: (store: string) => void;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  dateRange: {
    from: string;
    to: string;
  };
  setDateRange: (range: { from: string; to: string }) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
}

const EmailFilter: React.FC<EmailFilterProps> = ({
  selectedStore,
  setSelectedStore,
  selectedStatus,
  setSelectedStatus,
  dateRange,
  setDateRange,
  searchTerm,
  setSearchTerm
}) => {
  const { stores, statuses } = useInbox();
  const [isOpen, setIsOpen] = React.useState(false);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const clearFilters = () => {
    setSelectedStore('all');
    setSelectedStatus('all');
    setDateRange({ from: '', to: '' });
    setSearchTerm('');
    setIsOpen(false);
  };

  const getActiveFilterCount = () => {
    return [
      selectedStore !== 'all',
      selectedStatus !== 'all',
      dateRange.from,
      dateRange.to,
      searchTerm.trim()
    ].filter(Boolean).length;
  };

  return (
    <div className="border-b border-gray-200 bg-white p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search emails..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
        >
          <Filter size={16} />
          <span>Filters</span>
          {getActiveFilterCount() > 0 && (
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
              {getActiveFilterCount()}
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 bg-white rounded-md border border-gray-200 shadow-sm">
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="store" className="block text-sm font-medium text-gray-700 mb-2">
                Store
              </label>
              <select
                id="store"
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="all">All Stores</option>
                {stores.map(store => (
                  <option key={store.id} value={store.name}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                id="status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="all">All Statuses</option>
                {statuses.map(status => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="from" className="block text-sm font-medium text-gray-700 mb-2">
                From Date
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar size={16} className="text-gray-400" />
                </div>
                <input
                  type="date"
                  id="from"
                  name="from"
                  value={dateRange.from}
                  onChange={handleDateChange}
                  max={dateRange.to || undefined}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="to" className="block text-sm font-medium text-gray-700 mb-2">
                To Date
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar size={16} className="text-gray-400" />
                </div>
                <input
                  type="date"
                  id="to"
                  name="to"
                  value={dateRange.to}
                  onChange={handleDateChange}
                  min={dateRange.from || undefined}
                  max={new Date().toISOString().split('T')[0]}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-gray-50 flex justify-end rounded-b-md">
            <button
              onClick={clearFilters}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 mr-2"
            >
              <X size={16} className="mr-1" />
              Clear
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailFilter;