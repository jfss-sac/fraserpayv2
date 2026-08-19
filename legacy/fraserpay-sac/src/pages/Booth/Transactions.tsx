import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useTransactions } from '@/contexts/transactions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import Layout from '@/components/Layout';
import TransactionItem from '@/components/TransactionItem';
import { toast } from 'sonner';
import { Transaction } from '@/types';
import { Loader2 } from 'lucide-react';
import { fetchBoothTransactions } from '@/contexts/transactions/transactionService';

const BoothTransactions = () => {
  const { boothId } = useParams<{ boothId: string }>();
  const { user } = useAuth();
  const { getBoothById, isLoading } = useTransactions();
  const navigate = useNavigate();
  
  const [booth, setBooth] = useState<ReturnType<typeof getBoothById>>(undefined);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activeTab, setActiveTab] = useState('transactions');
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadBoothHistory = async () => {
    if (!boothId) return;
    setLoadingTransactions(true);
    setError(null);
    try {
      const boothTransactions = await fetchBoothTransactions(boothId);
      setTransactions(boothTransactions);
    } catch (err) {
      console.error('Error loading booth transactions:', err);
      setError('Failed to load transactions');
      toast.error('Failed to load transactions');
    } finally {
      setLoadingTransactions(false);
    }
  };

  useEffect(() => {
    if (boothId) {
      const boothData = getBoothById(boothId);
      setBooth(boothData);

      if (boothData) {
        loadBoothHistory();
      }
    }
  }, [boothId, getBoothById]);

  useEffect(() => {
    if (!booth) {
      console.log("Initiative not found or user doesn't have access");
      // We'll handle this in the render method below
    }
  }, [booth]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    
    if (value === 'dashboard') {
      navigate(`/booth/${boothId}`);
    } else if (value === 'sell') {
      navigate(`/booth/${boothId}/sell`);
    } else if (value === 'settings') {
      navigate(`/booth/${boothId}/settings`);
    }
  };

  const handleRefreshTransactions = async () => {
    setIsRefreshing(true);
    await loadBoothHistory();
    setIsRefreshing(false);
  };

  if (!booth) {
    return (
      <Layout title={isLoading ? "Loading..." : "Initiative not found"} showBack>
        <div className="text-center py-10">
          {isLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          ) : (
            <p className="text-muted-foreground">The initiative you're looking for could not be found</p>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout 
      title={booth.name} 
      subtitle="Initiative Management" 
      showBack
    >
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard" className="tab-button">Dashboard</TabsTrigger>
          <TabsTrigger value="sell" className="tab-button">Sell</TabsTrigger>
          <TabsTrigger value="transactions" className="tab-button">History</TabsTrigger>
          <TabsTrigger value="settings" className="tab-button">Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="transactions" className="animate-fade-in mt-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-muted-foreground text-sm">
                Showing all transactions for this initiative
              </div>
              <Button variant="ghost" size="sm" onClick={handleRefreshTransactions} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
            
            {loadingTransactions || isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Loading transactions...</span>
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                <p>{error}</p>
              </div>
            ) : transactions.length > 0 ? (
              <div className="space-y-3">
                {transactions.map((transaction) => (
                  <React.Fragment key={transaction.id}>
                    {/* Support button intentionally disabled here because it has no action. */}
                    <TransactionItem 
                      transaction={transaction}
                    />
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No transactions yet</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
};

export default BoothTransactions;
