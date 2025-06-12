import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Star } from 'lucide-react';
import { normalizeSubject } from '../../utils/email';

interface Email {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  read: boolean;
  priority: number;
  status: string;
  storeName: string;
  storeColor: string;
  thread_id?: string;
  direction?: 'inbound' | 'outbound';
  recipient?: string;
}

interface EmailListItemProps {
  email: Email;
  threadSubject?: string;
  onClick?: () => void;
}

const EmailListItem: React.FC<EmailListItemProps> = ({ email, threadSubject, onClick }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleClick = () => {
    navigate(`/inbox/email/${email.id}`, {
      state: { from: location.pathname }
    });
  };

  // Use thread subject if provided, otherwise normalize the email subject
  const displaySubject = threadSubject || normalizeSubject(email.subject);

  return (
    <div 
      onClick={handleClick}
      className={`flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
        email.read ? 'bg-white' : 'bg-blue-50'
      }`}
    >
      <div className="w-8">
        <div 
          className={`w-2 h-2 rounded-full ${email.read ? 'bg-transparent' : 'bg-blue-600'}`}
        ></div>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center">
          <div 
            className="h-4 w-4 rounded-full mr-2" 
            style={{ backgroundColor: email.storeColor }}
          ></div>
          <p className={`text-sm font-medium truncate ${email.read ? 'text-gray-900' : 'text-gray-900 font-semibold'}`}>
            {displaySubject}
          </p>
        </div>
        <p className="text-xs text-gray-500 truncate mt-1">
          <span className="font-medium">
            {email.direction === 'outbound' 
              ? `To: ${email.recipient}` 
              : `From: ${email.from}`
            }
          </span> - {email.snippet}
        </p>
      </div>
      
      <div className="w-32 text-xs text-gray-500">
        {formatDate(email.date)}
      </div>
      
      <div className="w-24 flex justify-center">
        {Array.from({ length: 3 }).map((_, i) => (
          <Star 
            key={i}
            size={16}
            className={`${
              i < email.priority
                ? 'text-yellow-400 fill-current'
                : 'text-gray-300'
            }`}
          />
        ))}
      </div>
      
      <div className="w-24">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(email.status)}`}>
          {email.status}
        </span>
      </div>
    </div>
  );
};

export default EmailListItem;