
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import Layout from '@/components/Layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InfoIcon, AlertTriangle, Eye, EyeOff } from 'lucide-react';

const Register = () => {
  useEffect(() => {
    navigate('/login', { replace: true });
  }, [])
  const [studentNumber, setStudentNumber] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const {
    register,
    loginWithGoogle,
    isAuthenticated,
    user
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && user) {
      console.log("Register page: User is authenticated, redirecting", user.role);
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNetworkError(false);
    if (!studentNumber || !name || !email || !password || !confirmPassword) {
      toast.error("Missing information", {
        description: "Please fill out all fields",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match", {
        description: "Please make sure your passwords match",
      });
      return;
    }
    if (!email.includes('@')) {
      toast.error("Invalid email", {
        description: "Please enter a valid email address",
      });
      return;
    }
    setIsLoading(true);
    try {
      await register(studentNumber, name, email, password);
      setSuccess(true);
      setStudentNumber('');
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/network-request-failed') {
        setNetworkError(true);
      } else {
        toast.error("Registration failed", {
          description: error instanceof Error ? error.message : "There was an error creating your account",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      console.log("Starting Google sign-in process from Register page");
      const userData = await loginWithGoogle();
      console.log("Google sign-in completed, result:", !!userData);
      
      if (userData) {
        console.log("Google sign-in successful, redirecting to dashboard");
        navigate('/dashboard', { replace: true });
      }
    } catch (error) {
      console.error('Google login error:', error);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const retryConnection = () => {
    setNetworkError(false);
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const logo = <div className="flex items-center justify-center mb-6">
      <img src="/lovable-uploads/ed1f3f9a-22a0-42de-a8cb-354fb8c82dae.png" alt="Fraser Pay" className="w-48 h-auto" />
    </div>;

  return <Layout showBack title="Create Account">
      <div className="flex flex-col items-center justify-center min-h-[80vh] animate-fade-in">
        {logo}
        
        <div className="w-full max-w-md mx-auto">
          <Card className="border-none shadow-lg glass-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">Create Account</CardTitle>
              <CardDescription className="text-center">
                Choose how you want to create your account
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              {networkError ? <div className="space-y-4">
                  <Alert className="bg-amber-50 border-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-700">
                      <p className="font-semibold mb-2">Network connection error</p>
                      <p>Unable to connect to authentication server. Please check your internet connection and try again.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="flex justify-center">
                    <Button onClick={retryConnection} className="bg-brand-600 hover:bg-brand-700">
                      Retry Connection
                    </Button>
                  </div>
                </div> : success ? <div className="space-y-4">
                  <Alert className="bg-green-50 border-green-200">
                    <InfoIcon className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-700">
                      <p className="font-semibold mb-2">Registration successful!</p>
                      <p>Your account has been created successfully.</p>
                      <p className="mt-2">You can now log in with your credentials.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="flex justify-center">
                    <Button onClick={() => navigate('/login')} className="bg-brand-600 hover:bg-brand-700">
                      Go to Login
                    </Button>
                  </div>
                </div> : <div className="space-y-4">
                  <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2" onClick={handleGoogleSignIn} disabled={isGoogleLoading}>
                    {isGoogleLoading ? "Signing in..." : <>
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" className="h-5 w-5">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Sign up with Google
                      </>}
                  </Button>
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or register with email
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="studentNumber">Student Number</Label>
                      <Input id="studentNumber" type="text" placeholder="Enter your student number" value={studentNumber} onChange={e => setStudentNumber(e.target.value)} disabled={isLoading} required className="bg-white/50" />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <Input id="name" type="text" placeholder="Enter your full name" value={name} onChange={e => setName(e.target.value)} disabled={isLoading} required className="bg-white/50" />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" placeholder="your.email@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={isLoading} required className="bg-white/50" />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <div className="relative">
                        <Input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={isLoading} required className="bg-white/50 pr-10" />
                        <button type="button" className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <div className="relative">
                        <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={isLoading} required className="bg-white/50 pr-10" />
                        <button type="button" className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700" onClick={() => setShowConfirmPassword(!showConfirmPassword)} tabIndex={-1}>
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    
                    <Button type="submit" className="w-full bg-brand-600 hover:bg-brand-700" disabled={isLoading}>
                      {isLoading ? "Creating Account..." : "Create Account"}
                    </Button>
                  </form>
                </div>}
            </CardContent>
            
            <CardFooter>
              <div className="text-sm text-center w-full text-muted-foreground">
                <span>Already have an account? </span>
                <Link to="/login" className="text-brand-600 hover:underline">
                  Sign in
                </Link>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </Layout>;
};

export default Register;
