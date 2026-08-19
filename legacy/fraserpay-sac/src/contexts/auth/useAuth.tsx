
import { useContext } from 'react';
import { AuthContext } from './AuthProvider';
import { AuthContextType } from './types';

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    console.error('Auth context is undefined, Provider may be missing');
    // Instead of immediately throwing, log the error and return a default state
    return {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      login: async () => {},
      loginWithGoogle: async () => null, // Updated to match the correct return type
      register: async () => false,
      logout: async () => false,
      verifyBoothPin: async () => ({ success: false }),
      verifySACPin: async () => false,
      joinBooth: () => {},
      session: null,
      updateUserData: () => {},
    };
  }
  
  return context;
};
