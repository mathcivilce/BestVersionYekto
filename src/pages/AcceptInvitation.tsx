import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Mail, CheckCircle, AlertCircle, Loader, Eye, EyeOff, Lock, User, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { InvitationDetails } from '../types/team';

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
  met: boolean;
}

const AcceptInvitation: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signUp } = useAuth();
  
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  
  // Validation state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [passwordRequirements, setPasswordRequirements] = useState<PasswordRequirement[]>([
    { label: 'At least 8 characters', test: (p) => p.length >= 8, met: false },
    { label: 'Contains uppercase letter', test: (p) => /[A-Z]/.test(p), met: false },
    { label: 'Contains lowercase letter', test: (p) => /[a-z]/.test(p), met: false },
    { label: 'Contains number', test: (p) => /\d/.test(p), met: false },
    { label: 'Contains special character', test: (p) => /[!@#$%^&*(),.?":{}|<>]/.test(p), met: false },
  ]);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link');
      setLoading(false);
      return;
    }
    
    validateInvitation(token);
  }, [token]);

  useEffect(() => {
    // Update password requirements when password changes
    setPasswordRequirements(prev =>
      prev.map(req => ({ ...req, met: req.test(password) }))
    );
  }, [password]);

  const validateInvitation = async (token: string) => {
    try {
      setLoading(true);
      
      // Call the validate-invitation Edge Function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to validate invitation');
      }

      const data = await response.json();
      const invitationData = data.invitation;
      
      // Pre-fill form with invitation data
      setInvitation(invitationData);
      setFirstName(invitationData.first_name || '');
      setLastName(invitationData.last_name || '');
      setJobTitle(invitationData.job_title || '');
      
    } catch (error: any) {
      console.error('Error validating invitation:', error);
      setError(error.message || 'Invalid or expired invitation');
    } finally {
      setLoading(false);
    }
  };

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
      case 'password':
        const unmetRequirements = passwordRequirements.filter(req => !req.test(value));
        if (unmetRequirements.length > 0) {
          return `Password must meet all requirements`;
        }
        return '';
      case 'passwordConfirmation':
        if (!value) return 'Password confirmation is required';
        if (value !== password) return 'Passwords do not match';
        return '';
      default:
        return '';
    }
  };

  const handleFieldChange = (name: string, value: string) => {
    setFieldErrors(prev => ({ ...prev, [name]: '' }));
    
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
      case 'password':
        setPassword(value);
        break;
      case 'passwordConfirmation':
        setPasswordConfirmation(value);
        break;
    }
  };

  const handleFieldBlur = (name: string, value: string) => {
    const error = validateField(name, value);
    setFieldErrors(prev => ({ ...prev, [name]: error }));
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    errors.firstName = validateField('firstName', firstName);
    errors.lastName = validateField('lastName', lastName);
    errors.jobTitle = validateField('jobTitle', jobTitle);
    errors.password = validateField('password', password);
    errors.passwordConfirmation = validateField('passwordConfirmation', passwordConfirmation);
    
    // Remove empty errors
    Object.keys(errors).forEach(key => {
      if (!errors[key]) delete errors[key];
    });
    
    console.log('Form validation:', { errors, fieldErrors });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAcceptInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    if (!invitation) {
      setError('Invitation data not found');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // Create account with Supabase Auth
      const { error: signUpError } = await signUp(
        invitation.email,
        password,
        {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          job_title: jobTitle.trim(),
          business_id: invitation.business_id,
          role: invitation.role,
          invitation_token: token,
        }
      );

      if (signUpError) {
        throw signUpError;
      }

      // Show success message
      toast.success(`Welcome to ${invitation.business_name}! Your account has been created.`);
      
      // Redirect to dashboard
      navigate('/dashboard');
      
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      setError(error.message || 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  const getPasswordStrength = (): { strength: number; label: string; color: string } => {
    const metRequirements = passwordRequirements.filter(req => req.met).length;
    const strength = (metRequirements / passwordRequirements.length) * 100;
    
    if (strength < 40) return { strength, label: 'Weak', color: 'bg-red-500' };
    if (strength < 80) return { strength, label: 'Fair', color: 'bg-yellow-500' };
    return { strength, label: 'Strong', color: 'bg-green-500' };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <Loader className="h-8 w-8 animate-spin text-blue-600" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Validating invitation...
          </h2>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Invalid Invitation
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {error}
          </p>
          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              Return to homepage
            </button>
          </div>
        </div>
      </div>
    );
  }

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Users className="h-8 w-8 text-blue-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Join {invitation?.business_name}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {invitation?.inviter_name} has invited you to join their team as a{' '}
          <span className="font-medium">{invitation?.role}</span>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleAcceptInvitation}>
            {/* First Name */}
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                First Name <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => handleFieldChange('firstName', e.target.value)}
                  onBlur={(e) => handleFieldBlur('firstName', e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldErrors.firstName ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="John"
                  required
                />
              </div>
              {fieldErrors.firstName && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.firstName}</p>
              )}
            </div>

            {/* Last Name */}
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                Last Name <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => handleFieldChange('lastName', e.target.value)}
                  onBlur={(e) => handleFieldBlur('lastName', e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldErrors.lastName ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="Doe"
                  required
                />
              </div>
              {fieldErrors.lastName && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.lastName}</p>
              )}
            </div>

            {/* Job Title */}
            <div>
              <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700">
                Job Title <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Briefcase className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="jobTitle"
                  type="text"
                  value={jobTitle}
                  onChange={(e) => handleFieldChange('jobTitle', e.target.value)}
                  onBlur={(e) => handleFieldBlur('jobTitle', e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldErrors.jobTitle ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="Customer Support Specialist"
                  required
                />
              </div>
              {fieldErrors.jobTitle && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.jobTitle}</p>
              )}
            </div>

            {/* Email (Read-only) */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email Address
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={invitation?.email || ''}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                  readOnly
                />
              </div>
            </div>

            {/* Role (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Role
              </label>
              <div className="mt-1">
                <span className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-800">
                  {invitation?.role?.charAt(0).toUpperCase()}{invitation?.role?.slice(1)}
                </span>
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Create Password <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => handleFieldChange('password', e.target.value)}
                  onBlur={(e) => handleFieldBlur('password', e.target.value)}
                  className={`block w-full pl-10 pr-10 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldErrors.password ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                  required
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Password Strength Indicator */}
              {password && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Password strength:</span>
                    <span className={`font-medium ${
                      passwordStrength.strength < 40 ? 'text-red-600' : 
                      passwordStrength.strength < 80 ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: `${passwordStrength.strength}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Password Requirements */}
              <div className="mt-3 space-y-1">
                {passwordRequirements.map((req, index) => (
                  <div key={index} className="flex items-center text-xs">
                    <CheckCircle 
                      className={`h-3 w-3 mr-2 ${req.met ? 'text-green-500' : 'text-gray-300'}`} 
                    />
                    <span className={req.met ? 'text-green-700' : 'text-gray-500'}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>

              {fieldErrors.password && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
              )}
            </div>

            {/* Password Confirmation */}
            <div>
              <label htmlFor="passwordConfirmation" className="block text-sm font-medium text-gray-700">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="passwordConfirmation"
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(e) => handleFieldChange('passwordConfirmation', e.target.value)}
                  onBlur={(e) => handleFieldBlur('passwordConfirmation', e.target.value)}
                  className={`block w-full pl-10 pr-10 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldErrors.passwordConfirmation ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                  required
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowPasswordConfirmation(!showPasswordConfirmation)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {showPasswordConfirmation ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              {fieldErrors.passwordConfirmation && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.passwordConfirmation}</p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="text-sm text-red-700">{error}</div>
              </div>
            )}

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={submitting || !firstName.trim() || !lastName.trim() || !jobTitle.trim() || !password || !passwordConfirmation || password !== passwordConfirmation || passwordRequirements.some(req => !req.met)}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader className="animate-spin -ml-1 mr-3 h-5 w-5" />
                    Creating Account...
                  </>
                ) : (
                  'Create Account & Join Team'
                )}
              </button>
            </div>
          </form>

          {/* Security Note */}
          <div className="mt-6 p-4 bg-blue-50 rounded-md">
            <div className="text-xs text-blue-700">
              <strong>Secure Account Creation:</strong> Your password is encrypted and never stored in plain text. 
              This invitation will expire on {invitation && new Date(invitation.expires_at).toLocaleDateString()}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcceptInvitation; 