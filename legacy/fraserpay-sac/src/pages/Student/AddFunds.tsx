import React, { useState } from 'react';
import { useAuth } from '@/contexts/auth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import Layout from '@/components/Layout';

const AddFunds = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    
    setIsLoading(true);
    
    // For demo purposes, we'll show a success message
    // In a real app, this would generate a request for a SAC member to process
    setTimeout(() => {
      setIsLoading(false);
      toast.success(`Please visit the SAC booth to complete your ${paymentMethod} payment of $${parseFloat(amount).toFixed(2)}`);
      navigate('/dashboard');
    }, 1500);
  };

  return (
    <Layout title="Add Funds" showBack>
      <div className="max-w-md mx-auto animate-fade-in">
        <Card className="border-none shadow-lg glass-card">
          <CardHeader>
            <CardTitle className="text-xl text-center">Add Funds to Your Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (CAD)</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <span className="text-muted-foreground">$</span>
                  </div>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-7"
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-3">
                <Label>Payment Method</Label>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as 'cash' | 'card')}
                  className="flex flex-col space-y-2"
                >
                  <div className="flex items-center space-x-2 border rounded-md p-3">
                    <RadioGroupItem value="cash" id="cash" />
                    <Label htmlFor="cash" className="cursor-pointer flex-1">Cash</Label>
                  </div>
                  <div className="flex items-center space-x-2 border rounded-md p-3">
                    <RadioGroupItem value="card" id="card" />
                    <Label htmlFor="card" className="cursor-pointer flex-1">Card</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
                <p>
                  To add funds to your account, you must visit the SAC booth and exchange cash or pay by card.
                  After submitting this request, please proceed to the SAC booth.
                </p>
              </div>
              
              <Button
                type="submit"
                className="w-full bg-brand-600 hover:bg-brand-700"
                disabled={isLoading}
              >
                {isLoading ? "Processing..." : "Request to Add Funds"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="text-xs text-center text-muted-foreground">
            <p className="w-full">
              All transactions are securely logged in the FraserPay system.
            </p>
          </CardFooter>
        </Card>
      </div>
    </Layout>
  );
};

export default AddFunds;
