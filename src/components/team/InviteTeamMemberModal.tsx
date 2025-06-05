import React, { useState } from 'react';
import { X, Mail, UserPlus, Crown, Shield, Eye, User, Briefcase } from 'lucide-react';
import { UserRole, InviteTeamMemberRequest } from '../../types/team';

interface InviteTeamMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: (request: InviteTeamMemberRequest) => Promise<void>;
}

const InviteTeamMemberModal: React.FC<InviteTeamMemberModalProps> = ({
  isOpen,
  onClose,
  onInvite,
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('agent');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (name: string, value: string): string => {
    switch (name) {
      case 'firstName':
        if (!value.trim()) return 'First name is required';
        if (value.trim().length < 2) return 'First name must be at least 2 characters';
        if (!/^[a-zA-Z\s]+$/.test(value.trim())) return 'First name must contain only letters';
        return '';
      case 'lastName':
        if (!value.trim()) return 'Last name is required';
        if (value.trim().length < 2) return 'Last name must be at least 2 characters';
        if (!/^[a-zA-Z\s]+$/.test(value.trim())) return 'Last name must contain only letters';
        return '';
      case 'jobTitle':
        if (!value.trim()) return 'Job title is required';
        if (value.trim().length < 2) return 'Job title must be at least 2 characters';
        return '';
      case 'email':
        if (!value.trim()) return 'Email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Please enter a valid email address';
        return '';
      default:
        return '';
    }
  };

  const handleFieldChange = (name: string, value: string) => {
    // Clear error for this field
    setErrors(prev => ({ ...prev, [name]: '' }));
    
    // Update field value
    switch (name) {
      case 'firstName':
        setFirstName(value);
        break;
      case 'lastName':
        setLastName(value);
        break;
      case 'jobTitle':
        setJobTitle(value);
        break;
      case 'email':
        setEmail(value);
        break;
    }
  };

  const handleFieldBlur = (name: string, value: string) => {
    // Only validate if the field has content to avoid showing errors immediately
    if (value.trim()) {
      const error = validateField(name, value);
      setErrors(prev => ({ ...prev, [name]: error }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    newErrors.firstName = validateField('firstName', firstName);
    newErrors.lastName = validateField('lastName', lastName);
    newErrors.jobTitle = validateField('jobTitle', jobTitle);
    newErrors.email = validateField('email', email);
    
    // Remove empty errors
    Object.keys(newErrors).forEach(key => {
      if (!newErrors[key]) delete newErrors[key];
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      await onInvite({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim(),
        email: email.trim().toLowerCase(),
        role,
      });
      
      // Reset form
      setFirstName('');
      setLastName('');
      setJobTitle('');
      setEmail('');
      setRole('agent');
      setErrors({});
      onClose();
    } catch (error: any) {
      setErrors({ submit: error.message || 'Failed to send invitation' });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFirstName('');
    setLastName('');
    setJobTitle('');
    setEmail('');
    setRole('agent');
    setErrors({});
    onClose();
  };

  const getRoleDescription = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'Full access to manage team, billing, and all features';
      case 'agent':
        return 'Can view and reply to emails, add notes, and manage their own assignments';
      case 'observer':
        return 'Read-only access to view emails and notes';
      default:
        return '';
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Crown size={16} className="text-yellow-500" />;
      case 'agent':
        return <Shield size={16} className="text-blue-500" />;
      case 'observer':
        return <Eye size={16} className="text-gray-500" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={handleClose}
        ></div>

        {/* Modal panel - increased height for additional fields */}
        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6 max-h-[90vh] overflow-y-auto">
          <div className="absolute top-0 right-0 pt-4 pr-4">
            <button
              type="button"
              className="bg-white rounded-md text-gray-400 hover:text-gray-600"
              onClick={handleClose}
            >
              <span className="sr-only">Close</span>
              <X size={24} />
            </button>
          </div>

          <div className="sm:flex sm:items-start">
            <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
              <UserPlus className="h-6 w-6 text-blue-600" />
            </div>
            <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Invite Team Member
              </h3>
              <div className="mt-2">
                <p className="text-sm text-gray-500">
                  Send an invitation to join your team. They'll receive an email with a link to accept and create their account.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                {/* First Name Input */}
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="firstName"
                      value={firstName}
                      onChange={(e) => handleFieldChange('firstName', e.target.value)}
                      onBlur={(e) => handleFieldBlur('firstName', e.target.value)}
                      className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:border-blue-500 ${
                        errors.firstName ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                      }`}
                      placeholder="John"
                      required
                    />
                  </div>
                  {errors.firstName && (
                    <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
                  )}
                </div>

                {/* Last Name Input */}
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="lastName"
                      value={lastName}
                      onChange={(e) => handleFieldChange('lastName', e.target.value)}
                      onBlur={(e) => handleFieldBlur('lastName', e.target.value)}
                      className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:border-blue-500 ${
                        errors.lastName ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                      }`}
                      placeholder="Doe"
                      required
                    />
                  </div>
                  {errors.lastName && (
                    <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
                  )}
                </div>

                {/* Job Title Input */}
                <div>
                  <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700">
                    Job Title <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Briefcase className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="jobTitle"
                      value={jobTitle}
                      onChange={(e) => handleFieldChange('jobTitle', e.target.value)}
                      onBlur={(e) => handleFieldBlur('jobTitle', e.target.value)}
                      className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:border-blue-500 ${
                        errors.jobTitle ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                      }`}
                      placeholder="Customer Support Specialist"
                      required
                    />
                  </div>
                  {errors.jobTitle && (
                    <p className="mt-1 text-sm text-red-600">{errors.jobTitle}</p>
                  )}
                </div>

                {/* Email Input */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      onBlur={(e) => handleFieldBlur('email', e.target.value)}
                      className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:border-blue-500 ${
                        errors.email ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
                      }`}
                      placeholder="john.doe@company.com"
                      required
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                  )}
                </div>

                {/* Role Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-3">
                    {(['admin', 'agent', 'observer'] as UserRole[]).map((roleOption) => (
                      <label key={roleOption} className="flex items-start cursor-pointer">
                        <input
                          type="radio"
                          name="role"
                          value={roleOption}
                          checked={role === roleOption}
                          onChange={(e) => setRole(e.target.value as UserRole)}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                        />
                        <div className="ml-3">
                          <div className="flex items-center">
                            {getRoleIcon(roleOption)}
                            <span className="ml-2 text-sm font-medium text-gray-900 capitalize">
                              {roleOption}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {getRoleDescription(roleOption)}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Submit Error Message */}
                {errors.submit && (
                  <div className="rounded-md bg-red-50 p-4">
                    <div className="text-sm text-red-700">{errors.submit}</div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="mt-6 sm:mt-8 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Sending Invitation...
                      </>
                    ) : (
                      'Send Invitation'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InviteTeamMemberModal; 