
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useTransactions } from '@/contexts/transactions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Layout from '@/components/Layout';
import { ChevronRight } from 'lucide-react';

const BoothDashboard = () => {
  const { boothId } = useParams<{ boothId: string; }>();
  const { user } = useAuth();
  const { getBoothById } = useTransactions();
  const navigate = useNavigate();

  const [booth, setBooth] = useState<ReturnType<typeof getBoothById>>(undefined);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    if (boothId) {
      const boothData = getBoothById(boothId);
      setBooth(boothData);
    }
  }, [boothId, getBoothById]);
  
  // Remove role-based restriction, just check if booth exists
  useEffect(() => {
    if (!booth) {
      console.log("Booth not found or user doesn't have access");
      // We'll handle this in the render method below
    }
  }, [booth]);
  
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'sell') {
      navigate(`/booth/${boothId}/sell`);
    } else if (value === 'transactions') {
      navigate(`/booth/${boothId}/transactions`);
    } else if (value === 'settings') {
      navigate(`/booth/${boothId}/settings`);
    }
  };
  
  if (!booth) {
    return (
      <Layout title="Initiative not found" showBack>
        <div className="text-center py-10">
          <p className="text-muted-foreground">The initiative you're looking for could not be found</p>
          <Button variant="link" onClick={() => navigate('/dashboard')} className="mt-4">
            Return to Dashboard
          </Button>
        </div>
      </Layout>
    );
  }
  
  return (
    <Layout title={booth.name} subtitle="Initiative Management" showBack>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard" className="tab-button">Dashboard</TabsTrigger>
          <TabsTrigger value="sell" className="tab-button">Sell</TabsTrigger>
          <TabsTrigger value="transactions" className="tab-button">History</TabsTrigger>
          <TabsTrigger value="settings" className="tab-button">Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="dashboard" className="animate-fade-in mt-6">
          <div className="space-y-6">
            {/* Total Sales Card */}
            <Card className="border-none shadow-md bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <CardContent className="p-6">
                <h3 className="text-lg font-medium text-white/80">Total Sales</h3>
                <p className="text-3xl font-bold">${booth.totalEarnings.toFixed(2)}</p>
              </CardContent>
            </Card>
            
            {/* Quick Actions */}
            <div className="grid grid-cols-1 gap-3">
              <Button variant="outline" className="justify-between h-auto py-4 px-4 bg-white shadow-sm border-border/50" onClick={() => navigate(`/booth/${boothId}/sell`)}>
                <span className="font-medium">Process a Sale</span>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Button>
              
              {/* Add Manage Products button here */}
              {/* <Button variant="outline" className="justify-between h-auto py-4 px-4 bg-white shadow-sm border-border/50" onClick={() => navigate(`/booth/${boothId}/settings`)}>
                <span className="font-medium">Manage Products</span>
                <Package className="h-5 w-5 text-muted-foreground" />
              </Button> */}
            </div>
            
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
};

export default BoothDashboard;
