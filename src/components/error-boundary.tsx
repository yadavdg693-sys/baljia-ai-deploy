'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global Error Boundary — catches unhandled React errors.
 * FIX: G-UI-001 — previously, unhandled errors would cause a white screen.
 *
 * Usage (in layout.tsx):
 *   <ErrorBoundary>
 *     {children}
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // In production, this would send to a monitoring service like Sentry
    // For now, structured console output (will be picked up by server logs)
    console.error('[ErrorBoundary] Unhandled React error:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '50vh',
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              padding: '2rem',
              borderRadius: '12px',
              border: '1px solid rgba(255, 100, 100, 0.2)',
              background: 'rgba(255, 50, 50, 0.05)',
              textAlign: 'center',
            }}
          >
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                marginBottom: '0.75rem',
                color: 'inherit',
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                fontSize: '0.875rem',
                opacity: 0.7,
                marginBottom: '1.5rem',
                lineHeight: 1.5,
              }}
            >
              An unexpected error occurred. This has been logged for our team to investigate.
            </p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <pre
                style={{
                  fontSize: '0.75rem',
                  padding: '1rem',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.1)',
                  overflow: 'auto',
                  textAlign: 'left',
                  marginBottom: '1rem',
                  maxHeight: '200px',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.625rem 1.5rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.08)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                transition: 'background 0.15s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
