import { useState, useCallback } from 'react';
import { Transaction, User, Product, PaymentMethod } from '@/types';
import { toast } from 'sonner';
import { addFunds as addFundsService } from '../transactionService';
import { addPoints as addPointsService } from '../transactionService';
import { firestore } from '@/integrations/firebase/client';
import { collection, query, where, getDocs } from 'firebase/firestore';

export interface UseTransactionReturn {
  recordTransaction: (
    buyerId: string,
    buyerName: string,
    products: {
      productId: string;
      productName: string;
      quantity: number;
      price: number;
    }[],
    amount: number,
    paymentMethod: PaymentMethod,
    boothId?: string,
    boothName?: string
  ) => Promise<boolean>;
  addFunds: (studentId: string, amount: number, sacMemberId: string) => Promise<{ success: boolean; message: string }>;
  addPoints: (studentId: string, amount: number, sacMemberId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  getTransactionsByDate: (dateRange: {startDate?: Date; endDate?: Date}, boothId?: string) => Promise<Transaction[]>;
  getTransactionsByBooth: (boothId: string) => Promise<Transaction[]>;
  getStudentTransactions: (studentId: string) => Promise<Transaction[]>;
  getBoothTransactions: (boothId: string) => Promise<Transaction[]>;
  getLeaderboard: () => Promise<{ boothId: string; boothName: string; boothDescription: string; earnings: number; }[]>;
  findUserByStudentNumber: (studentNumber: string) => Promise<User | null>;
  getBoothProducts: (boothId: string) => Promise<Product[]>;
  getUserBooths: (userId: string) => Promise<any[]>;
}

export const useTransaction = (): UseTransactionReturn => {
  // Implementation of record transaction
  const recordTransaction = async (
    buyerId: string,
    buyerName: string,
    products: {
      productId: string;
      productName: string;
      quantity: number;
      price: number;
    }[],
    amount: number,
    paymentMethod: PaymentMethod,
    boothId?: string,
    boothName?: string
  ): Promise<boolean> => {
    try {
      // Simulate recording a transaction
      console.log('Recording transaction:', {
        buyerId,
        buyerName,
        products,
        amount,
        paymentMethod,
        boothId,
        boothName
      });
      
      // In a real app, this would write to a database
      return true;
    } catch (error) {
      console.error('Error recording transaction:', error);
      return false;
    }
  };

  // Implementation of add funds
  const addFunds = async (
    studentId: string, 
    amount: number, 
    sacMemberId: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const result = await addFundsService(studentId, amount, sacMemberId);
      
      if (result.success) {
        return { 
          success: true, 
          message: `Successfully added $${amount.toFixed(2)} to account` 
        };
      } else {
        return { 
          success: false, 
          message: 'Failed to add funds' 
        };
      }
    } catch (error) {
      console.error('Error adding funds:', error);
      return { 
        success: false, 
        message: 'An error occurred while adding funds' 
      };
    }
  };

  const addPoints = async (
    studentId: string,
    amount: number,
    sacMemberId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
        const result = await addPointsService(studentId, amount, sacMemberId, reason);

        if (result.success) {
            return {
                success: true,
                message: `Successfully added ${amount} points to account`
            };
        } else {
            return {
                success: false,
                message: 'Failed to add points'
            };
        }
    } catch (error) {
        console.error('Error adding points:', error);
        return {
            success: false,
            message: 'An error occurred while adding points'
        };
    }
  };

  // Get transactions by date range
  const getTransactionsByDate = async (
    dateRange: {startDate?: Date; endDate?: Date},
    boothId?: string
  ): Promise<Transaction[]> => {
    // This would filter transactions by date in a real app
    return [];
  };

  // Get transactions by booth
  const getTransactionsByBooth = async (boothId: string): Promise<Transaction[]> => {
    // This would get transactions for a specific booth in a real app
    return [];
  };

  // Get student transactions
  const getStudentTransactions = async (studentId: string): Promise<Transaction[]> => {
    // This would get transactions for a specific student in a real app
    return [];
  };

  // Get booth transactions
  const getBoothTransactions = async (boothId: string): Promise<Transaction[]> => {
    try {
      // In a real implementation, this would query transactions from a database
      console.log(`Loading transactions for booth: ${boothId}`);
      return [];
    } catch (error) {
      console.error(`Error loading booth transactions: ${error}`);
      return [];
    }
  };

  // Get leaderboard data
  const getLeaderboard = async (): Promise<{ boothId: string; boothName: string; boothDescription: string; earnings: number }[]> => {
    // This would calculate leaderboard data in a real app
    return [];
  };

  // Find user by student number
  const findUserByStudentNumber = async (studentNumber: string): Promise<User | null> => {
    try {
      const usersRef = collection(firestore, 'users');
      const q = query(usersRef, where('student_number', '==', studentNumber));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        return null;
      }
      
      const userData = querySnapshot.docs[0].data();
      return {
        id: querySnapshot.docs[0].id,
        name: userData.name,
        email: userData.email,
        studentNumber: userData.student_number,
        role: userData.role,
        balance: (userData.tickets || 0) / 100, // Convert to dollars
        points: (userData.points || 0),
        booths: userData.booth_access || []
      };
    } catch (error) {
      console.error('Error finding user by student number:', error);
      return null;
    }
  };

  // Get booth products
  const getBoothProducts = async (boothId: string): Promise<Product[]> => {
    // This would get products for a specific booth in a real app
    return [];
  };

  // Get user booths
  const getUserBooths = async (userId: string): Promise<any[]> => {
    // This would get booths for a specific user in a real app
    return [];
  };

  return {
    recordTransaction,
    addFunds,
    addPoints,
    getTransactionsByDate,
    getTransactionsByBooth,
    getStudentTransactions,
    getBoothTransactions,
    getLeaderboard,
    findUserByStudentNumber,
    getBoothProducts,
    getUserBooths
  };
};
