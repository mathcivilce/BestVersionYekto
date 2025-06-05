import React, { useState, useEffect } from 'react';
import { User, Key, Bell, Loader2, Crown, Shield, Eye, Building2, Edit2, Check, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types/team';
import { TeamService } from '../services/teamService';
import toast from 'react-hot-toast';

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState('profile');
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditingBusinessName, setIsEditingBusinessName] = useState(false);
  const [editingBusinessName, setEditingBusinessName] = useState('');
  const [savingBusinessName, setSavingBusinessName] = useState(false);
  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    jobTitle: '',
    role: 'agent' as UserRole,
    businessName: '',
    businessId: ''
  });
  
  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User size={18} /> },
    { id: 'account', label: 'Account', icon: <Key size={18} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> },
  ];

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

  const getRoleBadge = (role: UserRole) => {
    const baseClasses = "px-2 py-1 text-xs font-medium rounded-full inline-flex items-center";
    switch (role) {
      case 'admin':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'agent':
        return `${baseClasses} bg-blue-100 text-blue-800`;
      case 'observer':
        return `${baseClasses} bg-gray-100 text-gray-800`;
      default:
        return baseClasses;
    }
  };

  useEffect(() => {
    console.log('Settings: useEffect triggered with user:', user);
    
    const fetchProfile = async () => {
      try {
        console.log('Settings: Starting profile fetch for user:', user?.id);
        console.log('Settings: About to call TeamService.getCurrentUserProfile()');
        
        const profile = await TeamService.getCurrentUserProfile();
        
        console.log('Settings: TeamService.getCurrentUserProfile() returned:', profile);

        if (profile) {
          const newProfileData = {
            firstName: profile.first_name || '',
            lastName: profile.last_name || '',
            jobTitle: profile.job_title || '',
            role: profile.role || 'agent',
            businessName: profile.business_name || '',
            businessId: profile.business_id || ''
          };
          
          console.log('Settings: Setting profile data to:', newProfileData);
          setProfileData(newProfileData);
        } else {
          console.log('Settings: No profile data returned from TeamService');
        }
      } catch (error) {
        console.error('Settings: Error fetching profile:', error);
        console.error('Settings: Error details:', {
          message: (error as any)?.message,
          name: (error as any)?.name,
          stack: (error as any)?.stack
        });
        toast.error('Failed to load profile data');
      } finally {
        console.log('Settings: Profile fetch completed, setting loading to false');
        setLoading(false);
      }
    };

    if (user?.id) {
      console.log('Settings: User ID exists, starting profile fetch');
      fetchProfile();
    } else {
      console.log('Settings: No user ID, setting loading to false');
      setLoading(false);
    }
  }, [user]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setSaving(true);

      await TeamService.updateUserProfile({
        first_name: profileData.firstName,
        last_name: profileData.lastName,
        job_title: profileData.jobTitle
      });

      toast.success('Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfileData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleEditBusinessName = () => {
    setEditingBusinessName(profileData.businessName);
    setIsEditingBusinessName(true);
  };

  const handleCancelBusinessNameEdit = () => {
    setIsEditingBusinessName(false);
    setEditingBusinessName('');
  };

  const handleSaveBusinessName = async () => {
    if (!editingBusinessName.trim()) {
      toast.error('Business name cannot be empty');
      return;
    }

    try {
      setSavingBusinessName(true);
      await TeamService.updateBusinessName(editingBusinessName.trim());
      
      // Update local state
      setProfileData(prev => ({
        ...prev,
        businessName: editingBusinessName.trim()
      }));
      
      setIsEditingBusinessName(false);
      setEditingBusinessName('');
      toast.success('Business name updated successfully');
    } catch (error) {
      console.error('Error updating business name:', error);
      toast.error('Failed to update business name');
    } finally {
      setSavingBusinessName(false);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } flex items-center`}
            >
              <span className={`mr-2 ${activeTab === tab.id ? 'text-blue-500' : 'text-gray-400'}`}>
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      
      <div className="p-6">
        {activeTab === 'profile' && (
          <div className="max-w-2xl">
            <h2 className="text-lg font-medium text-gray-900 mb-6">Profile Settings</h2>
            
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleProfileSubmit} className="space-y-6">
                {/* Role and Business Information */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Organization Information</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Building2 size={16} className="text-gray-400 mr-2" />
                        <span className="text-sm text-gray-600">Business:</span>
                      </div>
                      <div className="flex items-center">
                        {isEditingBusinessName ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editingBusinessName}
                              onChange={(e) => setEditingBusinessName(e.target.value)}
                              className="text-sm font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 min-w-0 w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveBusinessName();
                                } else if (e.key === 'Escape') {
                                  handleCancelBusinessNameEdit();
                                }
                              }}
                              autoFocus
                              disabled={savingBusinessName}
                            />
                            <button
                              type="button"
                              onClick={handleSaveBusinessName}
                              disabled={savingBusinessName}
                              className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                              title="Save"
                            >
                              {savingBusinessName ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Check size={14} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelBusinessNameEdit}
                              disabled={savingBusinessName}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <span className="text-sm font-medium text-gray-900">
                              {profileData.businessName || 'No business assigned'}
                            </span>
                            {profileData.role === 'admin' && (
                              <button
                                type="button"
                                onClick={handleEditBusinessName}
                                className="ml-2 p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                title={profileData.businessName ? "Edit business name" : "Set business name"}
                              >
                                <Edit2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        {getRoleIcon(profileData.role)}
                        <span className="text-sm text-gray-600 ml-2">Role:</span>
                      </div>
                      <span className={getRoleBadge(profileData.role)}>
                        {getRoleIcon(profileData.role)}
                        <span className="ml-1 capitalize">{profileData.role}</span>
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {profileData.role === 'admin' ? (
                      'As an admin, you can edit your business name by clicking the edit icon. Role information is managed by the system.'
                    ) : (
                      'Role and business information is managed by your team administrator.'
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                  <div className="sm:col-span-3">
                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                      First name
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      id="firstName"
                      value={profileData.firstName}
                      onChange={handleInputChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                      Last name
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      id="lastName"
                      value={profileData.lastName}
                      onChange={handleInputChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700">
                      Job Title
                    </label>
                    <input
                      type="text"
                      name="jobTitle"
                      id="jobTitle"
                      value={profileData.jobTitle}
                      onChange={handleInputChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                </div>
                
                <div className="pt-5">
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 size={16} className="mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
        
        {activeTab === 'account' && (
          <div className="max-w-2xl">
            <h2 className="text-lg font-medium text-gray-900 mb-6">Account Settings</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Change Password</h3>
                <div className="bg-gray-50 p-4 rounded-md space-y-4">
                  <div>
                    <label htmlFor="current-password" className="block text-sm font-medium text-gray-700">
                      Current Password
                    </label>
                    <input
                      type="password"
                      name="current-password"
                      id="current-password"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                      New Password
                    </label>
                    <input
                      type="password"
                      name="new-password"
                      id="new-password"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      name="confirm-password"
                      id="confirm-password"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  
                  <div className="pt-2">
                    <button
                      type="submit"
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Update Password
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Two-Factor Authentication</h3>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-500">
                      Add an extra layer of security to your account
                    </p>
                  </div>
                  <div className="ml-4">
                    <button
                      type="button"
                      className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Enable
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-sm font-medium text-red-600 mb-2">Danger Zone</h3>
                <div>
                  <button
                    type="button"
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Delete Account
                  </button>
                  <p className="mt-1 text-xs text-gray-500">
                    Once you delete your account, there is no going back. Please be certain.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'notifications' && (
          <div className="max-w-2xl">
            <h2 className="text-lg font-medium text-gray-900 mb-6">Notification Settings</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-3">Email Notifications</h3>
                <div className="space-y-4">
                  <div className="relative flex items-start">
                    <div className="flex items-center h-5">
                      <input
                        id="new-email"
                        name="new-email"
                        type="checkbox"
                        defaultChecked
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </div>
                    <div className="ml-3 text-sm">
                      <label htmlFor="new-email" className="font-medium text-gray-700">
                        New email received
                      </label>
                      <p className="text-gray-500">Get notified when a new customer email arrives.</p>
                    </div>
                  </div>
                  
                  <div className="relative flex items-start">
                    <div className="flex items-center h-5">
                      <input
                        id="assigned"
                        name="assigned"
                        type="checkbox"
                        defaultChecked
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </div>
                    <div className="ml-3 text-sm">
                      <label htmlFor="assigned" className="font-medium text-gray-700">
                        Email assigned to you
                      </label>
                      <p className="text-gray-500">Get notified when an email is assigned to you.</p>
                    </div>
                  </div>
                  
                  <div className="relative flex items-start">
                    <div className="flex items-center h-5">
                      <input
                        id="mentioned"
                        name="mentioned"
                        type="checkbox"
                        defaultChecked
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </div>
                    <div className="ml-3 text-sm">
                      <label htmlFor="mentioned" className="font-medium text-gray-700">
                        Mentioned in a note
                      </label>
                      <p className="text-gray-500">Get notified when someone mentions you in a note.</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Desktop Notifications</h3>
                <div className="space-y-4">
                  <div className="relative flex items-start">
                    <div className="flex items-center h-5">
                      <input
                        id="desktop"
                        name="desktop"
                        type="checkbox"
                        defaultChecked
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </div>
                    <div className="ml-3 text-sm">
                      <label htmlFor="desktop" className="font-medium text-gray-700">
                        Enable desktop notifications
                      </label>
                      <p className="text-gray-500">Show notifications in your browser.</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="pt-5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;