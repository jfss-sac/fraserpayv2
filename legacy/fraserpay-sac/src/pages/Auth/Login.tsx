import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import Layout from '@/components/Layout';
import { AlertCircle, Mail, Lock } from 'lucide-react';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { useIsMobile } from '@/hooks/use-mobile';
import { isPWA, showInstallBanner } from '@/utils/pwa';
import { Separator } from '@/components/ui/separator';
const Login = () => {
  const [studentNumber, setStudentNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPWAPrompt, setShowPWAPrompt] = useState(false);
  const {
    login,
    loginWithGoogle,
    isAuthenticated,
    user
  } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!isMobile || isPWA()) return;
    console.log("Login page: Setting up PWA install banner");
    return showInstallBanner(setShowPWAPrompt, 2000);
  }, [isMobile]);
//   useEffect(() => {
//     if (isAuthenticated && user) {
//       console.log("Login page: User is authenticated, redirecting", user.role);
//       navigate('/dashboard', {
//         replace: true
//       });
//     }
//   }, [isAuthenticated, user, navigate]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentNumber || !password) {
      toast.error("Missing information", {
        description: "Please enter both student number and password",
      });
      return;
    }
    setIsLoading(true);
    try {
      await login(studentNumber, password);
    } catch (error) {
      console.error('Login error:', error);
      toast.error("Login failed", {
        description: error instanceof Error ? error.message : "Please check your credentials and try again",
      });
    } finally {
      setIsLoading(false);
    }
  };
  // const handleBoothRequestClick = async () => {
  //   setIsGoogleLoading(true);
  //   try {
  //     console.log("Starting Google sign-in process from UI");
  //     const userData = await loginWithGoogle();
  //     if (userData) {
  //       let isAuthorizedUser = false;
  //       const authorizedEmails = ["795804@pdsb.net", "752470@pdsb.net", "793546@pdsb.net", "843909@pdsb.net", "890323@pdsb.net", "931108@pdsb.net", "1061713@pdsb.net", "845550@pdsb.net"];
  //       for (const email of authorizedEmails) {
  //           if (userData.email === email) {
  //               isAuthorizedUser = true;
  //               break;
  //           }
  //       }
  //       if (userData.email.endsWith("@pdsb.net") || userData.email.endsWith("@peelsb.com") || isAuthorizedUser) {
  //           console.log("Signed in with", userData.email);
  //           navigate('/request-booth', { replace: false });
  //       } else {
  //           toast({
  //               title: "Unsuccessful Login",
  //               description: "Please create a booth request with a teacher @pdsb.net account.",
  //               variant: "default"
  //           });
  //       }
  //     }
  //   } catch (error) {
  //     console.error('Google login error:', error);
  //   } finally {
  //     setIsGoogleLoading(false);
  //   }
  // };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      console.log("Starting Google sign-in process from UI");
      const userData = await loginWithGoogle();
      console.log("Google sign-in completed, result:", !!userData);
      if (userData) {
        console.log("Google sign-in successful, redirecting to dashboard");
        navigate('/dashboard', {
          replace: true
        });
      }
    } catch (error) {
      console.error('Google login error:', error);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return <Layout hideHeader={true}>
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-b from-background to-muted/30 animate-fade-in">
        <div className="mb-8">
          <img src="/lovable-uploads/ed1f3f9a-22a0-42de-a8cb-354fb8c82dae.png" alt="Fraser Pay" className="w-48 h-auto" />
        </div>
        
        <Card className="w-full max-w-md shadow-lg border-opacity-50">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-bold">Welcome</CardTitle>
            <CardDescription>
              Sign in to Access Your FraserPay account.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {/* Google Sign In Button */}
            <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2 h-11" onClick={handleGoogleSignIn} disabled={isGoogleLoading}>
              {isGoogleLoading ? "Signing in..." : <>
                  <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" className="h-5 w-5">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Sign in With Google
                </>}
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
            </div>

            {/* Booth request section — re-enable when requests open
            <CardDescription className="w-full text-center pt-4">Running a booth? Fill out the form below.</CardDescription>
            <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2 h-11" onClick={handleBoothRequestClick} disabled={isGoogleLoading}>
              {isGoogleLoading ? "Signing in..." : <>
                  <div className="h-full flex place-items-center uppercase rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 p-2 text-white bold">New!</div>Create a Booth Request
                </>}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
            </div>
            */}

          </CardContent>
          
          <CardFooter className="flex flex-col space-y-2 pt-0">            
            <div className="flex items-center justify-center text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3 mr-1" />
              <span className="text-center">Contact SAC if you need help signing in.</span>
            </div>
          </CardFooter>
        </Card>
      </div>
      
      {showPWAPrompt && <PWAInstallPrompt onClose={() => setShowPWAPrompt(false)} />}
    </Layout>;
};
export default Login;