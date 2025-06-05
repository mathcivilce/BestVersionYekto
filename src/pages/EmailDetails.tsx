import React from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useInbox } from '../contexts/InboxContext';
import EmailDetail from '../components/inbox/EmailDetail';

const EmailDetails: React.FC = () => {
  const { emailId } = useParams<{ emailId: string }>();
  const { getEmailById } = useInbox();
  const navigate = useNavigate();
  const location = useLocation();
  
  const email = getEmailById(emailId || '');

  const handleBack = () => {
    // Get the previous location from state, fallback to default inbox
    const previousPath = location.state?.from || '/inbox';
    navigate(previousPath);
  };
  
  if (!email) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-1">Email Not Found</h3>
          <p className="text-gray-500 mb-4">The email you're looking for doesn't exist or has been deleted.</p>
          <button
            onClick={() => navigate('/inbox')}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
          >
            Back to Inbox
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <EmailDetail 
        email={email} 
        onBack={handleBack} 
      />
    </div>
  );
};

export default EmailDetails;