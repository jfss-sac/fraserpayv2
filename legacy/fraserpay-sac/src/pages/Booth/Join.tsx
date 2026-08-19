import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useTransactions } from '@/contexts/transactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import Layout from '@/components/Layout';
import { uniqueToast } from '@/utils/toastHelpers';
import { Info, Loader2 } from 'lucide-react';
const BoothJoin: React.FC = () => {
  const {
    user,
    updateUserData
  } = useAuth();
  const {
    joinBooth,
    fetchAllBooths
  } = useTransactions();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(e.target.value);
    setError(null);
  };
  const handleJoinBooth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter a PIN code');
      return;
    }
    if (!user || !user.id) {
      uniqueToast.error('You must be logged in to join an initiative');
      return;
    }
    try {
      setIsJoining(true);
      setError(null);
      console.log(`Attempting to join initiative with PIN: ${pin}`);
      const success = await joinBooth(pin, user.id);
      if (success) {
        console.log('Successfully joined initiative, refreshing data...');
        const updatedBooths = await fetchAllBooths();
        const joinedBooth = updatedBooths.find(booth => booth.pin === pin);
        if (user) {
          const currentBooths = user.booths || [];
          if (joinedBooth && !currentBooths.includes(joinedBooth.id)) {
            const updatedUserBooths = [...currentBooths, joinedBooth.id];
            await updateUserData({
              ...user,
              booths: updatedUserBooths
            });
            console.log('Updated user data with new initiative access', updatedUserBooths);
          }
        }
        const eventData = JSON.stringify({
          timestamp: Date.now(),
          boothPin: pin,
          action: 'joined'
        });
        localStorage.setItem('boothJoined', eventData);
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'boothJoined',
          newValue: eventData
        }));
        if (joinedBooth) {
          uniqueToast.success('Successfully joined initiative!');
          navigate(`/booth/${joinedBooth.id}`);
        } else {
          uniqueToast.success('Successfully joined initiative!');
          navigate('/dashboard');
        }
      } else {
        setError('Invalid PIN code or unable to join initiative. Please check and try again.');
        uniqueToast.error('Failed to join initiative');
      }
    } catch (error) {
      console.error('Error joining initiative:', error);
      setError('An unexpected error occurred. Please try again.');
      uniqueToast.error('Failed to join initiative');
    } finally {
      setIsJoining(false);
    }
  };
  return <Layout title="Join an Initiative" subtitle="Enter the initiative PIN code" showBack>
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Join Initiative</CardTitle>
            <CardDescription>Enter the PIN code provided by your staff supervisor to join an initiative.</CardDescription>
          </CardHeader>
          
          <form onSubmit={handleJoinBooth}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="pin" className="text-sm font-medium">
                  Initiative PIN Code
                </label>
                <Input id="pin" type="number" value={pin} onChange={handlePinChange} placeholder="Enter 6-digit PIN" maxLength={6} className={error ? "border-destructive" : ""} disabled={isJoining} />
                
                {error && <div className="text-destructive text-sm flex items-center gap-1.5">
                    <Info className="h-4 w-4" />
                    <span>{error}</span>
                  </div>}
              </div>
              
              <div className="bg-muted/50 rounded-md p-3">
                <h4 className="text-sm font-medium mb-2">Don't have a PIN?</h4>
                <p className="text-sm text-muted-foreground">Ask your teacher or club supervisor to provide your initiative pin. If you need help with this, please visit the SAC table.</p>
              </div>
            </CardContent>
            
            <CardFooter className="flex justify-between flex-col sm:flex-row gap-3">
              <Button type="button" variant="outline" onClick={() => navigate('/dashboard')} disabled={isJoining} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={!pin.trim() || isJoining} className="w-full sm:w-auto">
                {isJoining ? <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </> : 'Join Initiative'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Separator className="my-8" />
        
        <div className="text-center">
          <h3 className="text-base font-medium mb-2">Need to Create a New Initiative?</h3>
          <p className="text-sm text-muted-foreground mb-4">Find the SAC table and ask a SAC member there to help you out.</p>
          <Button variant="link" onClick={() => navigate('/dashboard')}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    </Layout>;
};
export default BoothJoin;