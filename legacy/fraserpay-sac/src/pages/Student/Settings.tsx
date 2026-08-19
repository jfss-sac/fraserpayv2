
import React, { useState } from 'react';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import Layout from '@/components/Layout';
import { toast } from 'sonner';
import { Shield, Bell, HelpCircle, LifeBuoy, LogOut, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useNavigate } from 'react-router-dom';

const FRASERPAY_HELP_DOC_URL = 'https://docs.google.com/document/d/18PpPSb4bufaqN7lv8mrIsmRPzX9OvPIH3oRbWNCPhCA/edit?usp=sharing';

const Settings = () => {
  const {
    user,
    logout,
    loginWithGoogle
  } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  
  const handleSACAccess = async () => {
    try {
      // Directly trigger Google Sign-In for SAC access
      const googleUser = await loginWithGoogle();
      
      if (googleUser) {
        // If the user has the correct role after sign-in, navigate to SAC dashboard
        if (googleUser.role === 'sac') {
          navigate('/sac/dashboard');
          toast.success("SAC Access Granted", {
            description: "SAC access granted",
          });
        } else {
          toast.error("Access Denied", {
            description: "Your email is not authorized for SAC access.",
          });
        }
      } else {
        toast.error("SAC Access", {
          description: "Could not verify SAC access. Please try again.",
        });
      }
    } catch (error) {
      console.error("Error during SAC access:", error);
      toast.error("Error", {
        description: "An unexpected error occurred. Please try again.",
      });
    }
  };
    
  return <Layout title="Account Settings" showBack>
      <div className="space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>Account Settings</CardTitle>
            <CardDescription>Manage your account preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Student Number</span>
              <span className="font-medium">{user?.studentNumber}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{user?.name}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Role</span>
              <span className="font-medium capitalize">{user?.role}</span>
            </div>
          </CardContent>
        </Card>
      
        <Card>
          <CardHeader>
            <CardTitle>Help & Support</CardTitle>
            <CardDescription>Get help with FraserPay</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>How to Use FraserPay</span>
                <span className="text-xs text-muted-foreground">- Press View to View the Google Doc on How to FraserPay!</span>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={FRASERPAY_HELP_DOC_URL} target="_blank" rel="noreferrer">
                  View
                </a>
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center">
                <LifeBuoy className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>Support</span>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={() => setSupportOpen(true)}>
                Contact
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center">
                <Shield className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>SAC Admin Access</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleSACAccess}>
                Verify
              </Button>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="destructive" className="w-full" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </CardFooter>
        </Card>

        <AlertDialog open={supportOpen} onOpenChange={setSupportOpen}>
          <AlertDialogContent className="sm:max-w-md">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-8 w-8"
              onClick={() => setSupportOpen(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
            <AlertDialogHeader>
              <AlertDialogTitle>Contact Support</AlertDialogTitle>
              <AlertDialogDescription>
                Please Find the SAC booth or any SAC Members for Immediate Assistance.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="text-sm text-muted-foreground">
              Contact us at:
              <br />
              johnfraserstudentcouncil@gmail.com - General Contact
              <br />
              795804@pdsb.net - Sohum Padhye (Tech Liaison)
              <br />
              752470@pdsb.net - Yang Xue (Tech Liaison)
              <br />
              843909@pdsb.net - David Chen (Vice President)
              <br />
              793546@pdsb.net - Hamza Saleh (President)
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>;
};

export default Settings;
