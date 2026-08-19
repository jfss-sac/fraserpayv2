
import { useState, useCallback, useEffect } from 'react';
import { Transaction, TransactionStats, DateRange, Booth } from '@/types';
import { useAuth } from '@/contexts/auth';
import { 
  getLeaderboard as getLeaderboardService,
} from '../boothService';
import { fetchAllTransactions } from '../transactionService';
import { toast } from 'sonner';
import { getVersionedStorageItem, setVersionedStorageItem } from '@/utils/storageManager';

export interface UseTransactionManagementReturn {
  transactions: Transaction[];
  recentTransactions: Transaction[];
  loadBoothTransactions: (boothId: string) => Transaction[];
  loadUserFundsTransactions: () => Transaction[];
  loadUserTransactions: (userId: string) => Transaction[];
  getSACTransactions: () => Transaction[];
  getTransactionStats: (boothId: string, dateRange: DateRange) => TransactionStats;
  getLeaderboard: () => Promise<{ boothId: string; boothName: string; boothDescription: string; earnings: number }[]>;
}

export const useTransactionManagement = (booths: Booth[]): UseTransactionManagementReturn => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    const fetchTransactionsData = async () => {
      if (!isAuthenticated) return;
      
      console.log('Initializing transaction data fetch');
      try {
        const cachedTransactions = getVersionedStorageItem<Transaction[]>('transactions', []);
        const lastFetchTime = getVersionedStorageItem<number>('lastTransactionsFetch', 0);
        const now = Date.now();
        
        const cacheTime = 30 * 1000; // Reduced to 30 seconds for more responsive updates
        
        if (cachedTransactions.length > 0 && now - lastFetchTime < cacheTime) {
        //   console.log('Using cached transactions:', cachedTransactions.length);
          setTransactions(cachedTransactions);
          
          if (user && cachedTransactions.length > 0) {
            const userTxs = cachedTransactions.filter(t => t.buyerId === user.id);
            console.log('User transactions from cache:', userTxs.length);
            setRecentTransactions(userTxs.slice(0, 5));
          }
          return;
        }
        
        const allTransactions = await fetchAllTransactions();
        console.log('Fetched transactions:', allTransactions.length);
        setTransactions(allTransactions);
        
        setVersionedStorageItem('transactions', allTransactions, cacheTime);
        setVersionedStorageItem('lastTransactionsFetch', now);
        
        if (user && allTransactions.length > 0) {
          const userTxs = allTransactions.filter(t => t.buyerId === user.id);
        //   console.log('User transactions:', userTxs.length);
          setRecentTransactions(userTxs.slice(0, 5));
        }
      } catch (error) {
        console.error('Error in fetchTransactionsData:', error);
      }
    };
    
    fetchTransactionsData();
    
    // Poll more frequently (reduced from 15000ms to 10000ms)
    const intervalId = setInterval(fetchTransactionsData, 10000);
    return () => clearInterval(intervalId);
  }, [user?.id, isAuthenticated]);

  const loadBoothTransactions = (boothId: string) => {
    return transactions.filter(t => t.boothId === boothId);
  };

  const loadUserFundsTransactions = () => {
    if (!user) return [];
    return transactions.filter(t => t.type === 'fund' && t.buyerId === user.id);
  };

  const loadUserTransactions = (userId: string) => {
    return transactions.filter(t => 
      t.buyerId === userId && (t.type === 'purchase' || t.type === 'fund' || t.type === 'refund')
    );
  };

  const getSACTransactions = () => {
    return transactions;
  };

  const getTransactionStats = (boothId: string, dateRange: DateRange): TransactionStats => {
    const boothTransactions = transactions.filter(t => 
      t.boothId === boothId && 
      t.type === 'purchase' &&
      (!dateRange.startDate || new Date(t.timestamp) >= dateRange.startDate) &&
      (!dateRange.endDate || new Date(t.timestamp) <= dateRange.endDate)
    );
    
    const dailySales: {[key: string]: number} = {};
    boothTransactions.forEach(t => {
      const date = new Date(t.timestamp).toISOString().split('T')[0];
      dailySales[date] = (dailySales[date] || 0) + t.amount;
    });
    
    const productCount: {[key: string]: {count: number, name: string}} = {};
    boothTransactions.forEach(t => {
      t.products?.forEach(p => {
        if (!productCount[p.productId]) {
          productCount[p.productId] = {count: 0, name: p.productName};
        }
        productCount[p.productId].count += p.quantity;
      });
    });
    
    const topProducts = Object.entries(productCount)
      .map(([productId, data]) => ({
        productId,
        productName: data.name,
        count: data.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    const totalSales = boothTransactions.reduce((sum, t) => sum + t.amount, 0);
    
    return {
      dailySales,
      topProducts,
      totalSales
    };
  };

  const getLeaderboard = useCallback(async () => {
    try {
      console.log('Fetching fresh leaderboard data from Firebase');
      const leaderboard = await getLeaderboardService();
      
      // Keep a short-lived cache only as an offline/error fallback.
      setVersionedStorageItem('leaderboard', leaderboard, 60 * 1000);
      setVersionedStorageItem('lastLeaderboardFetch', Date.now());
      
      return leaderboard;
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      toast.error('Failed to fetch leaderboard data');
      
      return getVersionedStorageItem<{ boothId: string; boothName: string; boothDescription: string; earnings: number; }[]>('leaderboard', []);
    }
  }, []);

  return {
    transactions,
    recentTransactions,
    loadBoothTransactions,
    loadUserFundsTransactions,
    loadUserTransactions,
    getSACTransactions,
    getTransactionStats,
    getLeaderboard
  };
};
