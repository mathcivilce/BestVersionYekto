import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { ChevronDown, User, UserCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface TeamMember {
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface EmailAssignmentIndicatorProps {
  emailId: string;
  initialAssignedTo?: string | null;
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const EmailAssignmentIndicator: React.FC<EmailAssignmentIndicatorProps> = ({ 
  emailId, 
  initialAssignedTo 
}) => {
  const { user } = useAuth();
  const [assignedUserId, setAssignedUserId] = useState<string | null>(initialAssignedTo || null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState<any>(null);

  // Fetch team members
  useEffect(() => {
    const fetchTeamMembers = async () => {
      if (!user) return;

      try {
        const { data: currentProfile } = await supabase
          .from('user_profiles')
          .select('business_id')
          .eq('user_id', user.id)
          .single();

        if (!currentProfile?.business_id) return;

        const { data: members } = await supabase
          .from('user_profiles')
          .select('user_id, first_name, last_name, role')
          .eq('business_id', currentProfile.business_id)
          .order('first_name');

        setTeamMembers(members || []);
      } catch (error) {
        console.error('Error fetching team members:', error);
      }
    };

    fetchTeamMembers();
  }, [user]);

  // Set up real-time subscription
  useEffect(() => {
    if (!emailId || !user) return;

    const channelName = `assignment_${emailId}`;
    
    console.log('Setting up assignment subscription for email:', emailId);

    const assignmentChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emails',
          filter: `id=eq.${emailId}`,
        },
        (payload) => {
          console.log('Assignment update received:', payload);
          const updatedEmail = payload.new;
          setAssignedUserId(updatedEmail.assigned_to);
        }
      )
      .subscribe((status) => {
        console.log('Assignment channel status:', status);
      });

    setChannel(assignmentChannel);

    return () => {
      console.log('Cleaning up assignment subscription for email:', emailId);
      if (assignmentChannel) {
        supabase.removeChannel(assignmentChannel);
      }
    };
  }, [emailId, user]);

  const handleAssign = async (userId: string | null) => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('emails')
        .update({ assigned_to: userId })
        .eq('id', emailId);

      if (error) throw error;

      setIsOpen(false);
      // Don't update local state here - let real-time subscription handle it
      
    } catch (err) {
      console.error('Error updating assignment:', err);
    } finally {
      setLoading(false);
    }
  };

  const getAssignedUser = () => {
    return teamMembers.find(member => member.user_id === assignedUserId);
  };

  const assignedUser = getAssignedUser();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className={`
          inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md 
          transition-all duration-200 ease-in-out
          ${assignedUser
            ? 'bg-green-100 text-green-800 hover:bg-green-200' 
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }
          ${loading ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {loading ? (
          <Loader2 size={16} className="mr-2 animate-spin" />
        ) : assignedUser ? (
          <UserCheck size={16} className="mr-2" />
        ) : (
          <User size={16} className="mr-2" />
        )}
        
        <span className="transition-all duration-200">
          {assignedUser 
            ? `Assigned to ${assignedUser.first_name} ${assignedUser.last_name}`
            : 'Unassigned'
          }
        </span>
        
        <ChevronDown size={16} className={`ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          <div className="py-1">
            <button
              onClick={() => handleAssign(null)}
              disabled={loading}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center disabled:opacity-50"
            >
              <User size={16} className="mr-3" />
              Unassigned
            </button>
            
            {teamMembers.map((member) => (
              <button
                key={member.user_id}
                onClick={() => handleAssign(member.user_id)}
                disabled={loading}
                className={`
                  w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center disabled:opacity-50
                  ${member.user_id === assignedUserId ? 'bg-green-50 text-green-800' : 'text-gray-700'}
                `}
              >
                <UserCheck size={16} className="mr-3" />
                {member.first_name} {member.last_name}
                <span className="ml-auto text-xs text-gray-500 capitalize">
                  {member.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop to close dropdown */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default EmailAssignmentIndicator; 