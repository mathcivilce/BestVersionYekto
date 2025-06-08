# Email Management SaaS - Codebase Documentation

## Overview

This is a comprehensive email management SaaS application built with React, TypeScript, Supabase, and Deno Edge Functions. The application provides multi-platform email integration, team collaboration, and advanced email processing capabilities.

## Architecture Overview

### Frontend (React + TypeScript)
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS with responsive design
- **State Management**: React Context API
- **Routing**: React Router v6
- **Authentication**: Supabase Auth with custom flows
- **Build Tool**: Vite

### Backend (Supabase + Deno Edge Functions)
- **Database**: PostgreSQL with Supabase
- **Edge Functions**: Deno runtime for serverless functions
- **Authentication**: Supabase Auth with JWT tokens
- **Real-time**: Supabase Realtime subscriptions
- **Storage**: Supabase for file storage

### Email Integration
- **Microsoft Outlook**: OAuth 2.0 with MSAL and server-side flows
- **Google Gmail**: OAuth 2.0 (future implementation)
- **Custom Threading**: Platform-independent email threading system

## Project Structure

```
├── src/                          # Frontend source code
│   ├── components/               # Reusable React components
│   │   ├── auth/                # Authentication components
│   │   ├── dashboard/           # Dashboard-specific components
│   │   ├── email/               # Email display and management
│   │   ├── inbox/               # Inbox interface components
│   │   ├── layout/              # Layout and navigation
│   │   └── team/                # Team management components
│   ├── contexts/                # React Context providers
│   │   ├── AuthContext.tsx     # User authentication state
│   │   ├── InboxContext.tsx    # Email and store management
│   │   └── ThemeContext.tsx    # Theme management
│   ├── hooks/                   # Custom React hooks
│   ├── pages/                   # Page components
│   ├── services/                # API service functions
│   ├── types/                   # TypeScript type definitions
│   └── utils/                   # Utility functions
├── supabase/                    # Backend configuration
│   ├── functions/               # Deno Edge Functions
│   │   ├── oauth-callback/      # OAuth callback handler
│   │   ├── sync-emails/         # Email synchronization
│   │   ├── refresh-tokens/      # Token refresh management
│   │   └── [other functions]/   # Additional serverless functions
│   └── migrations/              # Database schema migrations
└── public/                      # Static assets
```

## Core Components

### 1. Authentication System (`src/contexts/AuthContext.tsx`)

**Purpose**: Manages user authentication throughout the application using Supabase Auth.

**Key Features**:
- User login/logout with email and password
- User registration with email confirmation
- Invitation-based signup for team collaboration
- Session management with automatic refresh
- Environment validation for Supabase configuration

**Authentication Flow**:
1. User provides email/password or accepts invitation
2. Supabase Auth validates credentials
3. JWT token stored in browser
4. Context provides user state to all components
5. Automatic session refresh on token expiration

### 2. Email Management (`src/contexts/InboxContext.tsx`)

**Purpose**: Central context for managing email data and store connections.

**Key Features**:
- Multi-platform email integration (Outlook, Gmail)
- Real-time email synchronization
- Store connection management (MSAL popup and server-side OAuth)
- Email CRUD operations (read, delete, status updates)
- Token management and automatic refresh

**Data Flow**:
1. User connects email store (via MSAL or server OAuth)
2. Store credentials saved to database
3. Emails synced from email provider APIs
4. Real-time updates via Supabase subscriptions
5. Automatic token refresh for expired credentials

### 3. Theme Management (`src/contexts/ThemeContext.tsx`)

**Purpose**: Manages application theming with support for light, dark, and system themes.

**Features**:
- Light/dark/system theme options
- Theme persistence via localStorage
- Real-time system theme change detection
- Tailwind CSS integration

### 4. Layout System (`src/components/layout/`)

**Purpose**: Provides consistent layout structure for authenticated pages.

**Components**:
- `Layout.tsx`: Main layout wrapper with sidebar and header
- `Sidebar.tsx`: Navigation sidebar with responsive design
- `Header.tsx`: Top header with user actions and breadcrumbs

**Responsive Design**:
- Desktop: Fixed sidebar + header + main content
- Mobile: Collapsible sidebar with floating toggle button

## Backend Architecture

### 1. OAuth Callback Function (`supabase/functions/oauth-callback/index.ts`)

**Purpose**: Handles OAuth 2.0 callbacks from Microsoft Azure AD for email account connections.

**Flow**:
1. User initiates OAuth in frontend
2. Frontend creates pending request with PKCE challenge
3. User redirected to Microsoft OAuth
4. Microsoft redirects back to this function with authorization code
5. Function exchanges code for access/refresh tokens
6. Function retrieves user info from Microsoft Graph
7. Function creates/updates store record with tokens
8. Function stores result for frontend polling

**Key Features**:
- PKCE (Proof Key for Code Exchange) for security
- Token refresh capability for long-term access
- Platform standardization (Microsoft → 'outlook')
- Comprehensive error handling
- Database polling pattern for results

### 2. Email Synchronization (`supabase/functions/sync-emails/index.ts`)

**Purpose**: Synchronizes emails from Microsoft Graph API into the application database.

**Key Features**:
- Custom threading system (Platform Independent - Phase 3)
- Token refresh capability for expired access tokens
- Comprehensive retry logic for rate limiting
- Batch processing for efficient database operations
- Real-time sync progress monitoring

**Performance Improvements**:
- ~70% faster sync (eliminated Microsoft Conversation API calls)
- Reduced API rate limiting
- Platform-independent threading logic
- Enhanced internal notes system

### 3. Token Refresh System (`supabase/functions/refresh-tokens/index.ts`)

**Purpose**: Manages automatic refresh of OAuth access tokens for email integrations.

**Key Features**:
- Platform-agnostic OAuth token refresh
- Intelligent filtering (only processes eligible stores)
- Comprehensive error handling and recovery strategies
- Performance monitoring and health tracking
- Retry logic with exponential backoff

**Store Eligibility Criteria**:
- Must be connected (connected: true)
- Must use server-side OAuth (oauth_method: 'server_side')
- Must be an OAuth platform (not IMAP/POP3)
- Must have a valid refresh token

## Database Schema

### Core Tables

#### 1. `businesses`
Central business entities in the multi-tenant system.
```sql
- id: uuid (Primary Key)
- name: text (Business display name)
- created_at: timestamptz
- created_by: uuid (References auth.users)
- updated_at: timestamptz
```

#### 2. `user_profiles`
Enhanced user profiles with business relationships and team management.
```sql
- user_id: uuid (References auth.users)
- business_id: uuid (References businesses)
- business_name: text (Cached for performance)
- role: text (admin, agent, observer)
- invited_by: uuid (References auth.users)
- invitation_token: text
- invitation_expires_at: timestamptz
```

#### 3. `stores`
Connected email account configurations.
```sql
- id: uuid (Primary Key)
- name: text (User-defined store name)
- platform: text (outlook, gmail)
- email: text (Account email address)
- connected: boolean
- status: text (active, issue, pending, syncing)
- color: text (UI identification color)
- access_token: text (OAuth access token)
- refresh_token: text (OAuth refresh token)
- token_expires_at: timestamptz
```

#### 4. `emails`
Email messages from connected stores.
```sql
- id: uuid (Primary Key)
- graph_id: text (Provider-specific ID)
- subject: text
- snippet: text (Preview text)
- content: text (Full body)
- from: text (Sender address)
- date: timestamptz
- read: boolean
- priority: integer
- status: text (open, pending, resolved)
- store_id: uuid (References stores)
- thread_id: text (Conversation identifier)
- assigned_to: uuid (References auth.users)
```

#### 5. `team_invitations`
Manages team member invitation workflow.
```sql
- id: uuid (Primary Key)
- email: text (Invitee email)
- business_id: uuid (References businesses)
- role: text (Assigned role)
- invited_by: uuid (References auth.users)
- invitation_token: text (Secure token)
- status: text (pending, accepted, expired, cancelled)
- expires_at: timestamptz
```

### Security Model

#### Row Level Security (RLS)
- **Business-centric data isolation**: Users can only access data within their business
- **Role-based permissions**: Different access levels for admin, agent, observer roles
- **Secure invitation system**: Token-based invitations with expiration

#### Authentication
- **JWT tokens**: Supabase Auth provides secure JWT tokens
- **Session management**: Automatic token refresh and session persistence
- **Multi-tenant support**: Complete data isolation between businesses

## Key Features

### 1. Multi-Platform Email Integration
- **Microsoft Outlook**: Full OAuth 2.0 integration with MSAL and server-side flows
- **Google Gmail**: Planned implementation with OAuth 2.0
- **Custom Threading**: Platform-independent email conversation threading

### 2. Team Collaboration
- **Business-centric model**: Users belong to businesses and collaborate on emails
- **Role-based access**: Admin, agent, and observer roles with different permissions
- **Invitation system**: Secure token-based team member invitations

### 3. Real-time Updates
- **Supabase Realtime**: Live updates for emails, assignments, and team changes
- **Optimistic updates**: Immediate UI feedback with server synchronization
- **Conflict resolution**: Handles concurrent updates gracefully

### 4. Advanced Email Processing
- **Custom threading**: Superior email conversation grouping
- **Status management**: Open, pending, resolved workflow
- **Assignment system**: Assign emails to team members
- **Priority handling**: Email priority levels for workflow management

### 5. Token Management
- **Automatic refresh**: Background token refresh for uninterrupted service
- **Error recovery**: Comprehensive error handling and recovery strategies
- **Security**: Secure token storage and transmission

## Development Workflow

### Frontend Development
1. **Component Development**: Create reusable React components with TypeScript
2. **Context Integration**: Use React Context for state management
3. **Styling**: Apply Tailwind CSS classes for responsive design
4. **Testing**: Test components in isolation and integration

### Backend Development
1. **Edge Functions**: Develop Deno functions for serverless operations
2. **Database Migrations**: Create SQL migrations for schema changes
3. **API Integration**: Integrate with email provider APIs
4. **Security**: Implement RLS policies and authentication

### Deployment
1. **Frontend**: Deploy to Vercel or similar platform
2. **Backend**: Supabase handles Edge Function deployment
3. **Database**: Supabase manages PostgreSQL hosting
4. **Environment**: Configure environment variables for all services

## Performance Optimizations

### Frontend
- **Code splitting**: Lazy loading of route components
- **Memoization**: React.memo and useMemo for expensive calculations
- **Virtual scrolling**: Efficient rendering of large email lists
- **Optimistic updates**: Immediate UI feedback

### Backend
- **Batch processing**: Process emails in batches to avoid timeouts
- **Retry logic**: Exponential backoff for API rate limiting
- **Caching**: Cache frequently accessed data
- **Connection pooling**: Efficient database connections

### Database
- **Indexes**: Strategic indexes for common queries
- **RLS optimization**: Efficient Row Level Security policies
- **Query optimization**: Optimized SQL queries for performance

## Security Considerations

### Authentication
- **JWT tokens**: Secure token-based authentication
- **Session management**: Automatic token refresh and expiration
- **Password security**: Supabase handles password hashing and validation

### Data Protection
- **Row Level Security**: Database-level access control
- **Multi-tenant isolation**: Complete data separation between businesses
- **Encryption**: Data encrypted in transit and at rest

### API Security
- **OAuth 2.0**: Industry-standard authentication for email providers
- **PKCE**: Proof Key for Code Exchange for enhanced security
- **Rate limiting**: Protection against API abuse

## Monitoring and Observability

### Logging
- **Structured logging**: Consistent log format across all functions
- **Error tracking**: Comprehensive error logging and reporting
- **Performance metrics**: Track function execution times and success rates

### Health Monitoring
- **System health**: Monitor database and API health
- **Token status**: Track token expiration and refresh status
- **Sync monitoring**: Monitor email synchronization success rates

## Future Enhancements

### Platform Expansion
- **Google Gmail**: Full Gmail integration with OAuth 2.0
- **Yahoo Mail**: Yahoo email integration
- **IMAP/POP3**: Generic email server support

### Advanced Features
- **AI-powered categorization**: Automatic email categorization
- **Smart replies**: AI-generated response suggestions
- **Analytics dashboard**: Advanced reporting and analytics
- **Mobile app**: Native mobile applications

### Performance
- **Caching layer**: Redis caching for improved performance
- **CDN integration**: Content delivery network for static assets
- **Database optimization**: Advanced query optimization and indexing

This documentation provides a comprehensive overview of the email management SaaS codebase. The application is designed with scalability, security, and maintainability in mind, using modern technologies and best practices throughout. 