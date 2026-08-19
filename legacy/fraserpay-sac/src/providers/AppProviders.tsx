
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import QueryProvider from './QueryProvider';
import { AuthProvider } from '@/contexts/auth';
import { TransactionProvider } from '@/contexts/transactions';
import { Toaster as SonnerToaster } from 'sonner';

// App providers wrapper component
const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <BrowserRouter>
      <QueryProvider>
        <AuthProvider>
          <TransactionProvider>
            {children}
            <SonnerToaster position="top-right" />
          </TransactionProvider>
        </AuthProvider>
      </QueryProvider>
    </BrowserRouter>
  );
};

export default AppProviders;
