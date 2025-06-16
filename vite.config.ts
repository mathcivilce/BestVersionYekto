import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite Configuration - Optimized for Performance
 * 
 * This configuration is optimized for production performance with:
 * - Manual chunk splitting for better caching
 * - Bundle size optimization
 * - Tree-shaking optimization
 * - Development performance improvements
 * 
 * Performance Features:
 * 1. Manual Chunk Splitting - Separates vendor libraries for better caching
 * 2. Asset Inlining - Inlines small assets to reduce HTTP requests
 * 3. Tree Shaking - Removes unused code from bundles
 * 4. Compression Ready - Optimized for gzip compression
 * 
 * Bundle Strategy:
 * - Main chunk: Core app code + contexts (~400KB expected)
 * - React vendor: React, React-DOM, React-Router (~150KB)
 * - UI vendor: Tailwind utilities, UI components (~100KB)
 * - Supabase vendor: Database and auth utilities (~120KB)
 * - Page chunks: Individual pages loaded on-demand (~50-100KB each)
 * 
 * Maintenance Notes:
 * - Monitor chunk sizes with `npm run build`
 * - Add new large dependencies to appropriate vendor chunks
 * - Test chunk loading in production-like conditions
 * - Review bundle analyzer output periodically
 */

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Path resolution for cleaner imports
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Development server configuration
  server: {
    port: 3000,
    open: true,
    // Enable HMR for faster development
    hmr: {
      overlay: true
    }
  },

  // Build configuration optimized for performance
  build: {
    // Modern browser target for smaller bundles
    target: 'es2020',
    
    // Increase chunk size warning limit (we're optimizing intentionally)
    chunkSizeWarningLimit: 1000,
    
    // Asset inlining threshold (4KB) - inline small assets to reduce requests
    assetsInlineLimit: 4096,
    
    // Source map generation for production debugging
    sourcemap: false, // Set to true if you need source maps in production
    
    // Minification settings
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove console.log in production for smaller bundles
        drop_console: true,
        drop_debugger: true,
        // Remove unused code
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn']
      },
      format: {
        // Remove comments in production
        comments: false
      }
    },

    rollupOptions: {
      output: {
        /**
         * MANUAL CHUNK SPLITTING STRATEGY
         * ===============================
         * 
         * This function controls how the bundle is split into chunks.
         * Benefits:
         * - Better browser caching (vendor chunks change less frequently)
         * - Parallel loading of chunks
         * - Smaller initial bundle size
         * - Improved Core Web Vitals
         * 
         * Chunk Strategy:
         * 1. react-vendor: React ecosystem (changes rarely)
         * 2. supabase-vendor: Database and auth (changes rarely)  
         * 3. ui-vendor: UI components and utilities (changes occasionally)
         * 4. utils-vendor: Other vendor libraries (changes occasionally)
         * 5. main: App code and contexts (changes frequently)
         * 6. Individual page chunks: Loaded on demand
         */
        manualChunks: (id) => {
          // React ecosystem - most stable, changes rarely
          if (id.includes('node_modules/react') || 
              id.includes('node_modules/react-dom') || 
              id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          
          // Supabase ecosystem - database and auth utilities
          if (id.includes('node_modules/@supabase') ||
              id.includes('node_modules/supabase')) {
            return 'supabase-vendor';
          }
          
          // Microsoft Graph API and MSAL libraries
          if (id.includes('node_modules/@microsoft') ||
              id.includes('node_modules/@azure') ||
              id.includes('node_modules/msal')) {
            return 'microsoft-vendor';
          }
          
          // UI and styling libraries
          if (id.includes('node_modules/tailwindcss') ||
              id.includes('node_modules/@tailwindcss') ||
              id.includes('node_modules/clsx') ||
              id.includes('node_modules/class-variance-authority') ||
              id.includes('node_modules/@radix-ui') ||
              id.includes('node_modules/lucide-react')) {
            return 'ui-vendor';
          }
          
          // Utility libraries - date handling, validation, etc.
          if (id.includes('node_modules/date-fns') ||
              id.includes('node_modules/zod') ||
              id.includes('node_modules/react-hook-form') ||
              id.includes('node_modules/react-hot-toast')) {
            return 'utils-vendor';
          }
          
          // Rich text editor and heavy dependencies
          if (id.includes('node_modules/@tiptap') ||
              id.includes('node_modules/prosemirror') ||
              id.includes('node_modules/codemirror')) {
            return 'editor-vendor';
          }
          
          // Other vendor libraries
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
          
          // Keep app code in main chunk
          return undefined;
        },
        
        /**
         * CHUNK FILE NAMING STRATEGY
         * =========================
         * 
         * Uses content hashes for long-term caching.
         * When content changes, hash changes, browser downloads new version.
         * When content doesn't change, browser uses cached version.
         */
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? 
            chunkInfo.facadeModuleId.split('/').pop()?.replace('.tsx', '').replace('.ts', '') : 
            'chunk';
          return `assets/${facadeModuleId}-[hash].js`;
        },
        
        // Asset file naming for caching
        assetFileNames: 'assets/[name]-[hash].[ext]',
        
        // Entry file naming
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },

  // Dependency optimization for faster development builds
  optimizeDeps: {
    include: [
      // Pre-bundle these dependencies for faster dev server startup
      'react',
      'react-dom',
      'react-router-dom',
      '@supabase/supabase-js',
      'react-hot-toast',
      'date-fns',
      'lucide-react'
    ],
    exclude: [
      // Don't pre-bundle these (they're already optimized or cause issues)
    ]
  },

  // Environment variable configuration
  define: {
    // Replace process.env.NODE_ENV for smaller bundles
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }
});