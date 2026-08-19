
import { useState } from 'react';
import { Transaction } from '@/types';

export interface UseTransactionUpdatesReturn {
  addTransaction: (transaction: Transaction) => void;
  transactions: Transaction[];
}

export const useTransactionUpdates = (initialTransactions: Transaction[] = []): UseTransactionUpdatesReturn => {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);

  const addTransaction = (transaction: Transaction) => {
    setTransactions(prev => [transaction, ...prev]);
  };

  return {
    addTransaction,
    transactions
  };
};
