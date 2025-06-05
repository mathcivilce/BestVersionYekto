import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Eye, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface EmailViewer {
  user_id: string;
  user_name: string;
  presence_ref: string;
  online_at: string;
}

interface EmailPresenceIndicatorProps {
  emailId: string;
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const EmailPresenceIndicator: React.FC<EmailPresenceIndicatorProps> = ({ emailId }) => {
  const { user } = useAuth();
  const [viewers, setViewers] = useState<EmailViewer[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [channel, setChannel] = useState<any>(null);

  // Get current user's profile information
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;

      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, business_id')
          .eq('user_id', user.id)
          .single();

        setCurrentUserProfile(profile);
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };

    fetchUserProfile();
  }, [user]);

  useEffect(() => {
    if (!emailId || !user || !currentUserProfile) return;

    const channelName = `email_presence_${emailId}`;
    const userName = currentUserProfile.first_name && currentUserProfile.last_name 
      ? `${currentUserProfile.first_name} ${currentUserProfile.last_name}`
      : user.email?.split('@')[0] || 'Unknown User';

    console.log('Setting up presence for email:', emailId, 'user:', userName);

    // Create presence channel for this email
    const presenceChannel = supabase.channel(channelName, {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    // Track presence events
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = presenceChannel.presenceState();
        console.log('Presence sync for email', emailId, ':', presenceState);
        
        const currentViewers: EmailViewer[] = [];
        
        Object.entries(presenceState).forEach(([userId, presences]) => {
          if (presences && presences.length > 0) {
            const presence = presences[0] as any;
            // Only show other users, not the current user
            if (userId !== user.id) {
              currentViewers.push({
                user_id: userId,
                user_name: presence.user_name,
                presence_ref: presence.presence_ref,
                online_at: presence.online_at
              });
            }
          }
        });
        
        setViewers(currentViewers);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('User joined email viewing:', key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('User left email viewing:', key, leftPresences);
      })
      .subscribe(async (status) => {
        console.log('Presence channel status:', status);
        if (status === 'SUBSCRIBED') {
          // Track that current user is viewing this email
          await presenceChannel.track({
            user_id: user.id,
            user_name: userName,
            email_id: emailId,
            online_at: new Date().toISOString(),
          });
          console.log('Started tracking presence for:', userName);
        }
      });

    setChannel(presenceChannel);

    // Cleanup on unmount or email change
    return () => {
      console.log('Cleaning up presence for email:', emailId);
      if (presenceChannel) {
        presenceChannel.unsubscribe();
      }
    };
  }, [emailId, user, currentUserProfile]);

  // Don't show anything if no other viewers
  if (viewers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4">
      <Eye className="w-4 h-4 text-blue-600" />
      <div className="flex items-center space-x-1">
        {viewers.length === 1 ? (
          <span className="text-sm text-blue-700">
            <span className="font-medium">{viewers[0].user_name}</span> is viewing
          </span>
        ) : viewers.length === 2 ? (
          <span className="text-sm text-blue-700">
            <span className="font-medium">{viewers[0].user_name}</span> and{' '}
            <span className="font-medium">{viewers[1].user_name}</span> are viewing
          </span>
        ) : (
          <span className="text-sm text-blue-700">
            <span className="font-medium">{viewers[0].user_name}</span> and{' '}
            <span className="font-medium">{viewers.length - 1} others</span> are viewing
          </span>
        )}
      </div>
      
      {/* Show avatars for viewers */}
      <div className="flex -space-x-1">
        {viewers.slice(0, 3).map((viewer, index) => (
          <div
            key={viewer.user_id}
            className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-white"
            title={viewer.user_name}
          >
            {viewer.user_name.charAt(0).toUpperCase()}
          </div>
        ))}
        {viewers.length > 3 && (
          <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-white">
            +{viewers.length - 3}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailPresenceIndicator; 