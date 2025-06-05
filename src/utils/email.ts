// Utility functions for email handling

/**
 * Removes common email prefixes like "Re:", "Fwd:", etc.
 * and standardizes the subject line
 */
export function normalizeSubject(subject: string): string {
  if (!subject) return 'No Subject';
  
  // Remove Re:, Fwd:, etc. (case insensitive)
  return subject.replace(/^(Re:|Fwd:|Fw:|Forward:)\s*/gi, '').trim();
}

/**
 * Gets the canonical subject for a thread by finding the first email
 * and normalizing its subject
 */
export function getThreadSubject(emails: any[], threadId: string): string {
  if (!threadId || !emails.length) return 'No Subject';

  // Find all emails in the thread
  const threadEmails = emails.filter(email => email.thread_id === threadId);
  
  if (!threadEmails.length) return 'No Subject';

  // Sort by date to find the original email
  const sortedEmails = threadEmails.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Get and normalize the original subject
  return normalizeSubject(sortedEmails[0].subject);
}