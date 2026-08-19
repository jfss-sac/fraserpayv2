import React, { createContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '@/types';
import { auth } from '@/integrations/firebase/client';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { AuthContextType } from './types';
import { fetchUserDataByAuthUid } from './authUtils';
import { 
  loginUser, 
  loginWithGoogle as loginWithGoogleOperation,
  registerUser, 
  logoutUser, 
  verifySACAccess, 
  verifyBoothAccess 
} from './authOperations';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    let authSettled = false;
    let authTimeout: ReturnType<typeof setTimeout> | null = null;

    const completeAuthInit = () => {
      if (!mounted || authSettled) return;
      authSettled = true;
      if (authTimeout) {
        clearTimeout(authTimeout);
      }
      setIsLoading(false);
    };

    const isAuthRoute = (path: string) => path === '/login' || path === '/register';
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    //   console.log("Auth state changed:", firebaseUser?.uid);
      if (!mounted) return;
      
      if (firebaseUser) {
        setAuthUser(firebaseUser);
        
        try {
          const userData = await fetchUserDataByAuthUid(firebaseUser.uid);
          
          if (mounted) {
            if (userData) {
            //   console.log("User data fetched successfully:", userData.id);
              setUser(userData);
            } else {
              console.warn("No user data found for authenticated user:", firebaseUser.uid);
              setUser(null);
            }
          }
        } catch (error) {
          console.error('Error in auth state change handler:', error);
        } finally {
          completeAuthInit();
        }
      } else {
        if (mounted) {
          setUser(null);
          setAuthUser(null);
        }
        completeAuthInit();
        
        if (!isAuthRoute(window.location.pathname)) {
          console.log("User signed out, redirecting to login");
          navigate('/login');
        }
      }
    });

    authTimeout = setTimeout(() => {
      if (mounted && !authSettled) {
        console.warn('Auth initialization timeout reached. Force completing auth loading.');
        completeAuthInit();
      }
    }, 3000);

    return () => {
      mounted = false;
      if (authTimeout) {
        clearTimeout(authTimeout);
      }
      unsubscribe();
    };
  }, [navigate]);

  const login = async (studentNumber: string, password: string) => {
    setIsLoading(true);
    try {
      const loggedInUser = await loginUser(studentNumber, password);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogleProvider = async (): Promise<User | null> => {
    setIsLoading(true);
    try {
      const userData = await loginWithGoogleOperation();
      console.log("loginWithGoogle completed, user data:", userData?.id);
      
      if (userData && !user) {
        console.log("Setting user data from Google login");
        setUser(userData);
      }
      
      return userData;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (studentNumber: string, name: string, email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      return await registerUser(studentNumber, name, email, password);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      const success = await logoutUser();
      if (success) {
        setUser(null);
        setAuthUser(null);
        navigate('/login');
      }
      return success;
    } finally {
      setIsLoading(false);
    }
  };

  const verifySACPin = async (): Promise<boolean> => {
    if (!user) return false;

    setIsLoading(true);
    try {
      const success = await verifySACAccess(user.id);
      if (success) {
        setUser(prev => prev ? { ...prev, role: 'sac' } : null);
        navigate('/sac/dashboard');
      }
      return success;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyBoothPin = async (pin: string): Promise<{ success: boolean, boothId?: string }> => {
    if (!user) return { success: false };
    
    setIsLoading(true);
    try {
      const result = await verifyBoothAccess(pin, user.id, user.booths);
      
      if (result.success && result.boothId) {
        setUser(prev => {
          if (!prev) return null;
          const updatedBooths = prev.booths?.includes(result.boothId!) 
            ? prev.booths 
            : [...(prev.booths || []), result.boothId!];
          
          return {
            ...prev,
            booths: updatedBooths
          };
        });
      }
      
      return result;
    } finally {
      setIsLoading(false);
    }
  };

  const joinBooth = (boothId: string) => {
    if (user) {
      navigate(`/booth/${boothId}`);
    }
  };

  const updateUserData = (userData: User) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithGoogle: loginWithGoogleProvider,
        register,
        logout,
        verifySACPin,
        verifyBoothPin,
        joinBooth,
        session: authUser,
        updateUserData
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
