import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth';
import { toast } from 'sonner';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { UserPlus, Upload, RefreshCw, AlertTriangle } from 'lucide-react';
import StatCards from './components/StatCards';
import UsersTable from './components/UsersTable';
import StudentSearch from './components/StudentSearch';
import TransactionsTable from './components/TransactionsTable';
import BoothLeaderboard from './components/BoothLeaderboard';
import BoothsList from './components/BoothsList';
import CreateBoothDialog from './components/CreateBoothDialog';
import StudentDetailDialog from './components/StudentDetailDialog';
import FundsDialog from './components/FundsDialog';
import PointsDialog from './components/PointsDialog';
import BoothTransactionDialog from './components/BoothTransactionDialog';
import AddUserDialog from './components/AddUserDialog';
import BulkImportDialog from './components/BulkImportDialog';
import DeleteUserDialog from './components/DeleteUserDialog';
import AuthorizedUsersDialog from './components/AuthorizedUsersDialog';
import { useTransactions } from '@/contexts/transactions';
import { generateQRCode, encodeUserData } from '@/utils/qrCode';
import { formatCurrency } from '@/utils/format';
import { firestore } from '@/integrations/firebase/client';
import { collection, query, orderBy, getDocs, doc, getDoc, updateDoc, increment, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { transformFirebaseUser } from '@/utils/firebase';
import { getVersionedStorageItem, setVersionedStorageItem } from '@/utils/storageManager';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import BoothRequestsList from './components/BoothRequestsList';

export interface StatsData {
  totalUsers: number;
  totalTickets: number;
  totalBooths: number;
  totalTransactions: number;
  totalRevenue: number;
}

const Dashboard = () => {
  const { user } = useAuth();
  const { 
    addFunds, 
    addPoints,
    booths, 
    boothRequests,
    fetchAllBooths,
    fetchAllBoothRequests,
    getBoothById, 
    createBooth: createBoothFromContext,
    addProductToBooth: addProductToBoothFromContext,
    deleteUser
  } = useTransactions();
  
  const [usersList, setUsersList] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [isUserLoading, setIsUserLoading] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionSearchTerm, setTransactionSearchTerm] = useState('');
  const [isTransactionLoading, setIsTransactionLoading] = useState(false);
  
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isBoothLoading, setIsBoothLoading] = useState(false);
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
  const [isBoothDialogOpen, setIsBoothDialogOpen] = useState(false);
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isDeleteUserDialogOpen, setIsDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any>(null);
  
  const [stats, setStats] = useState<StatsData>({
    totalUsers: 0,
    totalTickets: 0,
    totalBooths: 0,
    totalTransactions: 0,
    totalRevenue: 0
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [dataInitialized, setDataInitialized] = useState(false);
  
  const [foundStudent, setFoundStudent] = useState<any | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isStudentDetailOpen, setIsStudentDetailOpen] = useState(false);
  
  const [isFundsDialogOpen, setIsFundsDialogOpen] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [isAddPointsDialogOpen, setIsAddPointsDialogOpen] = useState(false);
  const [isRedeemPointsDialogOpen, setIsRedeemPointsDialogOpen] = useState(false);
  const [pointsTransactionReason, setPointsTransactionReason] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState('');
  
  const [isBoothTransactionOpen, setIsBoothTransactionOpen] = useState(false);
  
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  
  const [isAuthorizedUsersOpen, setIsAuthorizedUsersOpen] = useState(false);
  const isSuperAdmin = user?.email === '909957@pdsb.net';

  useEffect(() => {
    const initializeListeners = async () => {
      const criticalStatsPollingInterval = setInterval(() => {
        const now = Date.now();
        const lastCriticalStatsFetch = getVersionedStorageItem<number>('lastCriticalStatsFetch', 0);
        
        if (now - lastCriticalStatsFetch > 60000) {
          loadTransactions(true);
          loadBoothLeaderboard(true);
          setVersionedStorageItem('lastCriticalStatsFetch', now);
          setVersionedStorageItem('isUpdatingCriticalStats', true);
        }
      }, 60000);
      
      const fullDataPollingInterval = setInterval(() => {
        if (dataInitialized) {
          setVersionedStorageItem('isUpdatingCriticalStats', false);
          loadUsers();
          loadTransactions(false);
          loadBoothLeaderboard(false);
        }
      }, 150000);
      
      return () => {
        clearInterval(criticalStatsPollingInterval);
        clearInterval(fullDataPollingInterval);
      };
    };
    
    initializeListeners();
  }, [dataInitialized]);
  
  useEffect(() => {
    let isMounted = true;
    
    const initializeData = async () => {
      if (dataInitialized) return;
      
      setIsLoading(true);
      
      try {
        await Promise.all([
          loadUsers(),
          loadTransactions(),
          loadBoothLeaderboard()
        ]);
        
        if (isMounted) {
          setDataInitialized(true);
        }
      } catch (error) {
        console.error("Error initializing dashboard:", error);
        if (isMounted) {
          toast.error("There was an error loading data");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    initializeData();
    
    return () => {
      isMounted = false;
    };
  }, []);
  
  useEffect(() => {
    if (userSearchTerm) {
      const filtered = usersList.filter(user => 
        (user.name?.toLowerCase() || "").includes(userSearchTerm.toLowerCase()) || 
        (user.email?.toLowerCase() || "").includes(userSearchTerm.toLowerCase()) || 
        (user.student_number?.toLowerCase() || "").includes(userSearchTerm.toLowerCase())
      );
      setFilteredUsers(filtered);
    } else {
      setFilteredUsers(usersList);
    }
  }, [userSearchTerm, usersList]);
  
  const loadUsers = async () => {
    setIsUserLoading(true);
    try {
      const cachedUsers = getVersionedStorageItem<any[]>('sacUsers', []);
      const lastUsersFetch = getVersionedStorageItem<number>('lastSacUsersFetch', 0);
      const now = Date.now();
      
      if (cachedUsers.length > 0 && now - lastUsersFetch < 5 * 60 * 1000) {
        console.log('Using cached users:', cachedUsers.length);
        setUsersList(cachedUsers);
        setFilteredUsers(cachedUsers);
        
        const totalTickets = cachedUsers.reduce((sum, user) => sum + (user.tickets || 0), 0) / 100;
        setStats(prev => ({
          ...prev,
          totalUsers: cachedUsers.length,
          totalTickets: totalTickets
        }));
        
        setIsUserLoading(false);
        return;
      }
      
      const usersRef = collection(firestore, 'users');
      const q = query(usersRef, orderBy('created_at', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const users = querySnapshot.docs.map(doc => {
        const userData = doc.data();
        userData.id = doc.id;
        return userData;
      });
      
      console.log('SAC Dashboard: Loaded users from Firebase', users.length);
      setUsersList(users);
      setFilteredUsers(users);
      
      const totalTickets = users.reduce((sum, user) => sum + (user.tickets || 0), 0) / 100;
      
      setStats(prev => ({
        ...prev,
        totalUsers: users.length,
        totalTickets: totalTickets
      }));
      
      setVersionedStorageItem('sacUsers', users, 5 * 60 * 1000);
      setVersionedStorageItem('lastSacUsersFetch', now);
    } catch (error) {
      console.error('Error loading users from Firebase:', error);
      toast.error('Failed to load users');
      setUsersList([]);
      setFilteredUsers([]);
    } finally {
      setIsUserLoading(false);
    }
  };
  
  const loadTransactions = async (criticalUpdateOnly = false) => {
    setIsTransactionLoading(true);
    try {
      const cachedTransactions = getVersionedStorageItem<any[]>('sacTransactions', []);
      const lastTransactionsFetch = getVersionedStorageItem<number>('lastSacTransactionsFetch', 0);
      const now = Date.now();
      
      const cacheTime = criticalUpdateOnly ? 60000 : 150000;
      
      if (cachedTransactions.length > 0 && now - lastTransactionsFetch < cacheTime) {
        setTransactions(cachedTransactions);
        updateRevenueStats(cachedTransactions);
        setIsTransactionLoading(false);
        return;
      }
      
      if (criticalUpdateOnly && cachedTransactions.length > 0) {
        const transactionsRef = collection(firestore, 'transactions');
        const twoMinutesAgo = new Date();
        twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);
        const q = query(
          transactionsRef, 
          orderBy('created_at', 'desc')
        );
        
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          const recentTxs = querySnapshot.docs
            .map(doc => {
              const txData = doc.data();
              txData.id = doc.id;
              return txData;
            })
            .filter(tx => {
              return !cachedTransactions.some(cachedTx => cachedTx.id === tx.id);
            });
            
          if (recentTxs.length > 0) {
            console.log('SAC Dashboard: Found new transactions to add:', recentTxs.length);
            const allTransactions = [...recentTxs, ...cachedTransactions];
            setTransactions(allTransactions);
            updateRevenueStats(allTransactions);
            
            setVersionedStorageItem('sacTransactions', allTransactions, cacheTime);
            setVersionedStorageItem('lastSacTransactionsFetch', now);
          } else {
            setTransactions(cachedTransactions);
            updateRevenueStats(cachedTransactions);
          }
        } else {
          setTransactions(cachedTransactions);
          updateRevenueStats(cachedTransactions);
        }
        
        setIsTransactionLoading(false);
        return;
      }
      
      const transactionsRef = collection(firestore, 'transactions');
      const q = query(transactionsRef, orderBy('created_at', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const txs = querySnapshot.docs.map(doc => {
        const txData = doc.data();
        txData.id = doc.id;
        return txData;
      });
      
      console.log('SAC Dashboard: Loaded transactions from Firebase', txs.length);
      setTransactions(txs);
      
      updateRevenueStats(txs);
      
      setVersionedStorageItem('sacTransactions', txs, cacheTime);
      setVersionedStorageItem('lastSacTransactionsFetch', now);
    } catch (error) {
      console.error('Error loading transactions from Firebase:', error);
      toast.error('Failed to load transactions');
      setTransactions([]);
    } finally {
      setIsTransactionLoading(false);
    }
  };
  
  const loadBoothLeaderboard = async (criticalUpdateOnly = false) => {
    setIsBoothLoading(true);
    try {
      const cachedBooths = getVersionedStorageItem<any[]>('sacBooths', []);
      const lastBoothsFetch = getVersionedStorageItem<number>('lastSacBoothsFetch', 0);
      const now = Date.now();
      
      const cacheTime = criticalUpdateOnly ? 60000 : 150000;
      
      if (cachedBooths.length > 0 && now - lastBoothsFetch < cacheTime) {
        const sortedBooths = [...cachedBooths].sort((a, b) => b.totalEarnings - a.totalEarnings);
        setLeaderboard(sortedBooths);
        
        setStats(prev => ({
          ...prev,
          totalBooths: cachedBooths.length
        }));
        
        setIsBoothLoading(false);
        return;
      }
      
      const freshBooths = await fetchAllBooths();
      const boothsToUse = freshBooths && freshBooths.length > 0 ? freshBooths : booths;
      
      if (boothsToUse && boothsToUse.length > 0) {
        console.log('SAC Dashboard: Loaded booths', boothsToUse.length);
        
        const sortedBooths = [...boothsToUse].sort((a, b) => b.totalEarnings - a.totalEarnings);
        setLeaderboard(sortedBooths);
        
        setStats(prev => ({
          ...prev,
          totalBooths: boothsToUse.length
        }));
        
        setVersionedStorageItem('sacBooths', boothsToUse, cacheTime);
        setVersionedStorageItem('lastSacBoothsFetch', now);
      }
    } catch (error) {
      console.error('Error loading booths:', error);
      toast.error('Failed to load booths');
      setLeaderboard([]);
    } finally {
      setIsBoothLoading(false);
    }
  };
  
  const updateRevenueStats = (txs: any[]) => {
    const fundTransactions = txs.filter(tx => tx.type === 'fund' && tx.amount > 0);
    const refundTransactions = txs.filter(tx => tx.type === 'refund' || (tx.type === 'fund' && tx.amount < 0));
    
    const totalFundAmount = fundTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const totalRefundAmount = refundTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
    
    const netRevenue = (totalFundAmount - totalRefundAmount) / 100;
    
    setStats(prev => ({
      ...prev,
      totalTransactions: txs.length,
      totalRevenue: netRevenue
    }));
  };

  const refreshAllDashboardData = async () => {
    setIsRefreshingDashboard(true);
    try {
      setVersionedStorageItem('lastSacUsersFetch', 0);
      setVersionedStorageItem('lastSacTransactionsFetch', 0);
      setVersionedStorageItem('lastSacBoothsFetch', 0);
      setVersionedStorageItem('lastBoothRequestsFetch', 0);

      await Promise.all([
        loadUsers(),
        loadTransactions(),
        loadBoothLeaderboard(),
        fetchAllBoothRequests()
      ]);

      toast.success('Dashboard data refreshed');
    } catch (error) {
      console.error('Error refreshing dashboard data:', error);
      toast.error('Failed to refresh dashboard data');
    } finally {
      setIsRefreshingDashboard(false);
    }
  };
  
  const handleStudentFound = async (student: any, qrUrl: string) => {
    try {
      const userRef = doc(firestore, 'users', student.id);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        setFoundStudent({
          ...student,
          balance: (userData.tickets || 0) / 100,
          points: userData.points || 0
        });
      } else {
        setFoundStudent(student);
      }
    } catch (error) {
      console.error('Error fetching latest user data:', error);
      setFoundStudent(student);
    }
    
    setQrCodeUrl(qrUrl);
    setIsStudentDetailOpen(true);
  };
  
  const handleUserSelected = async (user: any) => {
    try {
      const userRef = doc(firestore, 'users', user.id);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        user = userSnap.data();
        user.id = userSnap.id;
      }
    } catch (error) {
      console.error('Error fetching latest user data:', error);
    }
    
    const student = {
      id: user.id,
      name: user.name,
      studentNumber: user.student_number,
      email: user.email,
      balance: (user.tickets || 0) / 100,
      points: user.points || 0,
      qrCode: user.qr_code
    };
    
    setFoundStudent(student);
    
    if (user.qr_code) {
      setQrCodeUrl(generateQRCode(user.qr_code));
    } else if (user.id) {
      const userData = encodeUserData(user.id);
      setQrCodeUrl(generateQRCode(userData));
      
      try {
        await updateDoc(doc(firestore, 'users', user.id), { 
          qr_code: userData 
        });
      } catch (error) {
        console.error('Error updating QR code:', error);
      }
    }
    
    setIsStudentDetailOpen(true);
  };
  
  const handleCreateBooth = async (boothData: { 
    name: string; 
    description: string; 
    pin: string;
    products: { name: string; price: number; image?: string }[];
  }) => {
    setIsBoothLoading(true);
    
    try {
      if (!user) {
        throw new Error("You must be logged in to create a booth");
      }
      
      console.log("Creating booth with data:", {
        name: boothData.name,
        description: boothData.description,
        pin: boothData.pin,
        products: boothData.products
      });
      
      const boothId = await createBoothFromContext(
        boothData.name,
        boothData.description || '',
        user.id,
        boothData.pin
      );
      
      if (!boothId) {
        throw new Error("Failed to create booth");
      }
      
      console.log("Booth created successfully with ID:", boothId);
      
      if (boothData.products && boothData.products.length > 0) {
        console.log("Adding products to booth:", boothData.products);
        
        for (const product of boothData.products) {
          await addProductToBoothFromContext(boothId, product);
        }
      }
      
      await loadBoothLeaderboard();
      
      toast.success('Booth created successfully');
      
    } catch (error) {
      console.error('Error creating booth:', error);
      toast.error('Failed to create booth: ' + (error instanceof Error ? error.message : 'Unknown error'));
      throw error;
    } finally {
      setIsBoothLoading(false);
    }
  };
  
  const handleAddFunds = (studentId: string) => {
    setSelectedStudentId(studentId);
    setIsFundsDialogOpen(true);
  };
  
  const handleRefund = (studentId: string) => {
    setSelectedStudentId(studentId);
    setIsRefundDialogOpen(true);
  };

  const handleAddPoints = (studentId: string) => {
    setSelectedStudentId(studentId);
    setIsAddPointsDialogOpen(true);
  }

  const handleRedeemPoints = (studentId: string) => {
    setSelectedStudentId(studentId);
    setIsRedeemPointsDialogOpen(true);
  }
  
  const handleProcessAddFunds = async (studentId: string, amount: number) => {
    if (!user) {
      toast.error('You must be logged in to add funds');
      return;
    }
    
    if (user.id === studentId) {
      toast.error('You cannot add funds to your own account');
      setIsFundsDialogOpen(false);
      return;
    }
    
    try {
      const result = await addFunds(studentId, amount, user.id);
      
      if (result.success) {
        toast.success(`Successfully added $${amount.toFixed(2)} to account`);
        
        const userRef = doc(firestore, 'users', studentId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && foundStudent) {
          const userData = userSnap.data();
          setFoundStudent({
            ...foundStudent,
            balance: (userData.tickets || 0) / 100,
          });
        }
        
        await loadUsers();
        await loadTransactions();
      } else {
        toast.error('Failed to add funds');
      }
    } catch (error) {
      console.error('Error adding funds:', error);
      toast.error('Failed to add funds');
    } finally {
      setIsFundsDialogOpen(false);
    }
  };
  
  const handleProcessRefund = async (studentId: string, amount: number) => {
    if (!user) {
      toast.error('You must be logged in to process refunds');
      return;
    }
    
    if (user.id === studentId) {
      toast.error('You cannot process refunds for your own account');
      setIsRefundDialogOpen(false);
      return;
    }
    
    try {
      const negativeAmount = -amount;
      
      const result = await addFunds(studentId, negativeAmount, user.id);
      
      if (result.success) {
        toast.success(`Successfully refunded $${amount.toFixed(2)}`);
        
        const userRef = doc(firestore, 'users', studentId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && foundStudent) {
          const userData = userSnap.data();
          setFoundStudent({
            ...foundStudent,
            balance: (userData.tickets || 0) / 100,
          });
        }
        
        setStats(prev => ({
          ...prev,
          totalRevenue: Math.max(0, prev.totalRevenue - amount)
        }));
        
        await loadUsers();
        await loadTransactions();
      } else {
        toast.error('Failed to process refund');
      }
    } catch (error) {
      console.error('Error processing refund:', error);
      toast.error('Failed to process refund');
    } finally {
      setIsRefundDialogOpen(false);
    }
  };

  const handleProcessAddPoints = async (studentId: string, amount: number) => {
    if (!user) {
        toast.error('You must be logged in to add points');
        return;
    }
    
    if (user.id === studentId) {
      toast.error('You cannot add points to your own account');
      setIsAddPointsDialogOpen(false);
      return;
    }
    
    try {
      const result = await addPoints(studentId, amount, user.id, pointsTransactionReason);
      
      if (result.success) {
        toast.success(`Successfully added ${amount} points to account`);
        
        const userRef = doc(firestore, 'users', studentId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && foundStudent) {
          const userData = userSnap.data();
          setFoundStudent({
            ...foundStudent,
            points: userData.points || 0
          });
        }
        
        await loadUsers();
        await loadTransactions();
      } else {
        toast.error('Failed to add points');
      }
    } catch (error) {
      console.error('Error adding points:', error);
      toast.error('Failed to add points');
    } finally {
      setIsFundsDialogOpen(false);
    }

  }

  const handleProcessRedeemPoints = async (studentId: string, amount: number) => {
    if (!user) {
        toast.error('You must be logged in to add points');
        return;
    }
    
    if (user.id === studentId) {
      toast.error('You cannot redeem points for your own account');
      setIsAddPointsDialogOpen(false);
      return;
    }
    
    try {
      amount = -amount;

      const result = await addPoints(studentId, amount, user.id, pointsTransactionReason);
      
      if (result.success) {
        toast.success(`Successfully redeemed ${amount} points`);
        
        const userRef = doc(firestore, 'users', studentId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && foundStudent) {
          const userData = userSnap.data();
          setFoundStudent({
            ...foundStudent,
            points: userData.points || 0
          });
        }
        
        await loadUsers();
        await loadTransactions();
      } else {
        toast.error('Failed to redeem points');
      }
    } catch (error) {
      console.error('Error redeeming points:', error);
      toast.error('Failed to redeem points');
    } finally {
      setIsFundsDialogOpen(false);
    }

  }

  
  const handlePrintQRCode = () => {
    if (!foundStudent || !foundStudent.qrCode) {
      toast.error('No QR code available to print');
      return;
    }
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Unable to open print window. Please check your popup blocker settings.');
      return;
    }

    const studentInfo = foundStudent.name || 'Student';
    const studentId = foundStudent.studentNumber || '';
    const qrCodeValue = foundStudent.qrCode || '';
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Code - ${studentInfo}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .container {
            max-width: 400px;
          }
          .student-info {
            margin-bottom: 20px;
          }
          .qr-code {
            margin: 20px 0;
            display: flex;
            justify-content: center;
          }
          h1 {
            margin-bottom: 5px;
          }
          @media print {
            body {
              padding: 0;
            }
            button {
              display: none;
            }
          }
        </style>
        <script src="https://unpkg.com/qrcode.react@4.2.0/dist/qrcode.react.js"></script>
        <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
        <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
      </head>
      <body>
        <div class="container">
          <div class="student-info">
            <h1>${studentInfo}</h1>
            ${studentId ? `<p>Student ID: ${studentId}</p>` : ''}
            <p>Balance: $${typeof foundStudent.balance === 'number' ? foundStudent.balance.toFixed(2) : '0.00'}</p>
          </div>
          <div class="qr-code">
            ${qrCodeValue ? 
              `<div id="qrcode"></div>` : 
              `<p>No QR code available</p>`
            }
          </div>
          <button onclick="window.print(); window.close();">Print QR Code</button>
        </div>
        <script>
          if (document.getElementById('qrcode') && "${qrCodeValue}") {
            var qrElement = React.createElement(QRCode.QRCodeSVG, {
              value: "${qrCodeValue}",
              size: 300,
              level: "M"
            });
            ReactDOM.render(qrElement, document.getElementById('qrcode'));
            
            setTimeout(() => {
              window.print();
            }, 1000);
          }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
    
    toast.success('QR code sent to printer');
  };
  
  const handleNewBoothClick = () => {
    setIsBoothDialogOpen(true);
  };
  
  const handleBoothTransactionClick = () => {
    setIsBoothTransactionOpen(true);
  };

  const handleAddUserClick = () => {
    setIsAddUserDialogOpen(true);
  };

  const handleUserAdded = () => {
    loadUsers();
  };
  
  const handleBulkImportClick = () => {
    setIsBulkImportOpen(true);
  };
  
  const handleDeleteUser = (user: any) => {
    setUserToDelete(user);
    setIsDeleteUserDialogOpen(true);
  };
  
  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    
    try {
      const success = await deleteUser(userToDelete.id);
      
      if (success) {
        setUsersList(prevUsers => prevUsers.filter(u => u.id !== userToDelete.id));
        setFilteredUsers(prevUsers => prevUsers.filter(u => u.id !== userToDelete.id));
        
        toast.success('User deleted successfully');
        
        setStats(prev => ({
          ...prev,
          totalUsers: prev.totalUsers - 1
        }));
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };
  
  const handleResetButtonClick = () => {
    setIsResetDialogOpen(true);
    setResetPassword('');
    setResetConfirmation(false);
    setResetError('');
  };

  const handleCheckPassword = () => {
    if (resetPassword === import.meta.env.VITE_FRASERPAY_RESET_PASSWORD) {
      setResetConfirmation(true);
      setResetError('');
    } else {
      setResetError('Incorrect password');
    }
  };

  const handleResetFraserPay = async () => {
    setIsResetting(true);
    try {
      const boothsCollection = collection(firestore, 'booths');
      const boothsSnapshot = await getDocs(boothsCollection);
      const boothDeletions = boothsSnapshot.docs.map(async (boothDoc) => {
        await deleteDoc(doc(firestore, 'booths', boothDoc.id));
      });
      await Promise.all(boothDeletions);
      
      const transactionsCollection = collection(firestore, 'transactions');
      const transactionsSnapshot = await getDocs(transactionsCollection);
      const transactionDeletions = transactionsSnapshot.docs.map(async (transactionDoc) => {
        await deleteDoc(doc(firestore, 'transactions', transactionDoc.id));
      });
      await Promise.all(transactionDeletions);

      const transactionProductsCollection = collection(firestore, 'transaction_products');
      const transactionProductsSnapshot = await getDocs(transactionProductsCollection);
      const transactionProductDeletions = transactionProductsSnapshot.docs.map(async (productDoc) => {
        await deleteDoc(doc(firestore, 'transaction_products', productDoc.id));
      });
      await Promise.all(transactionProductDeletions);

      setUsersList([]);
      setFilteredUsers([]);
      setTransactions([]);
      setLeaderboard([]);
      
      setStats({
        totalUsers: 0,
        totalTickets: 0,
        totalBooths: 0,
        totalTransactions: 0,
        totalRevenue: 0
      });

      setVersionedStorageItem('sacUsers', []);
      setVersionedStorageItem('sacTransactions', []);
      setVersionedStorageItem('sacBooths', []);
      setVersionedStorageItem('leaderboard', []);
      
      toast.success("FraserPay has been successfully reset");
      
      setIsResetDialogOpen(false);
      
      loadUsers();
      loadTransactions();
      loadBoothLeaderboard();
      fetchAllBooths();
      
    } catch (error) {
      console.error("Error resetting FraserPay:", error);
      toast.error("Failed to reset FraserPay");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Layout 
      title="SAC Dashboard" 
      showBack={true}
    >
      <div className="w-full space-y-6">
        <StatCards 
          stats={stats} 
          isLoading={isLoading}
        />
        
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 w-full">
          <Button
            variant="outline"
            onClick={refreshAllDashboardData}
            size="lg"
            className="w-full"
            disabled={isRefreshingDashboard}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingDashboard ? 'animate-spin' : ''}`} />
            {isRefreshingDashboard ? 'Refreshing...' : 'Refresh All Data'}
          </Button>
          <Button
            onClick={handleNewBoothClick}
            size="lg"
            className="w-full"
          >
            Create New Booth
          </Button>
          <Button
            variant="outline"
            onClick={handleBoothTransactionClick}
            size="lg"
            className="w-full"
          >
            Process Booth Transaction
          </Button>
          <Button
            onClick={handleAddUserClick}
            size="lg"
            className="w-full"
            variant="secondary"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
          <Button
            onClick={handleBulkImportClick}
            size="lg"
            className="w-full"
            variant="default"
          >
            <Upload className="mr-2 h-4 w-4" />
            Bulk Import
          </Button>
        </div>
        
        {isSuperAdmin && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setIsAuthorizedUsersOpen(true)}
            >
              Manage SAC Access
            </Button>
          </div>
        )}

        <StudentSearch onStudentFound={handleStudentFound} />
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <UsersTable 
              users={filteredUsers} 
              isLoading={isUserLoading} 
              searchTerm={userSearchTerm}
              onSearchChange={setUserSearchTerm}
              onUserSelect={handleUserSelected}
              onUserDelete={handleDeleteUser}
            />

            <BoothRequestsList 
                boothRequests={boothRequests}
                refresh={fetchAllBoothRequests}
            />
            
            <BoothsList
              booths={booths}
              isLoading={isBoothLoading}
            />
          </div>
          
          <div className="lg:col-span-5 space-y-6">
            <BoothLeaderboard 
              leaderboard={leaderboard} 
              isLoading={isBoothLoading}
            />
          </div>
        </div>
        
        <TransactionsTable 
          transactions={transactions} 
          users={usersList}
          searchTerm={transactionSearchTerm}
          onSearchChange={setTransactionSearchTerm}
          isLoading={isTransactionLoading}
        />
        
        {/*
        <div className="flex justify-end pt-4 border-t">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleResetButtonClick}
            className="text-destructive border-destructive hover:bg-destructive/10"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset FraserPay
          </Button>
        </div>
        */}
        
        <CreateBoothDialog 
          isOpen={isBoothDialogOpen}
          onOpenChange={setIsBoothDialogOpen}
          onCreateBooth={handleCreateBooth}
          isLoading={isBoothLoading}
        />
        
        {foundStudent && (
          <StudentDetailDialog 
            student={foundStudent}
            qrCodeUrl={qrCodeUrl}
            isOpen={isStudentDetailOpen}
            onOpenChange={setIsStudentDetailOpen}
            onAddFunds={handleAddFunds}
            onRefund={handleRefund}
            onAddPoints={handleAddPoints}
            onRedeemPoints={handleRedeemPoints}
            onPrintQRCode={handlePrintQRCode}
          />
        )}
        
        <FundsDialog
          isOpen={isFundsDialogOpen}
          onOpenChange={setIsFundsDialogOpen}
          title="Add Funds"
          description="Add funds to student account"
          confirmLabel="Add Funds"
          studentId={selectedStudentId}
          onSubmit={handleProcessAddFunds}
          readOnlyId={true}
        />
        
        <FundsDialog
          isOpen={isRefundDialogOpen}
          onOpenChange={setIsRefundDialogOpen}
          title="Process Refund"
          description="Refund funds from student account"
          confirmLabel="Process Refund"
          confirmVariant="destructive"
          studentId={selectedStudentId}
          onSubmit={handleProcessRefund}
          readOnlyId={true}
        />

        <PointsDialog
            isOpen={isAddPointsDialogOpen}
            onOpenChange={setIsAddPointsDialogOpen}
            title="Add Points"
            description="Add points to student account"
            confirmLabel="Add Points"
            studentId={selectedStudentId}
            onSubmit={handleProcessAddPoints}
            onReasonChange={(r: string) => setPointsTransactionReason(r)}
            readOnlyId={true}
        />

        <PointsDialog 
            isOpen={isRedeemPointsDialogOpen}
            onOpenChange={setIsRedeemPointsDialogOpen}
            title="Process Points Redemption"
            description="Redeem points from a student account"
            confirmLabel="Redeem Points"
            confirmVariant="destructive"
            studentId={selectedStudentId}
            onSubmit={handleProcessRedeemPoints}
            onReasonChange={(r: string) => setPointsTransactionReason(r)}
            readOnlyId={true}
        />
        
        <BoothTransactionDialog
          isOpen={isBoothTransactionOpen}
          onOpenChange={setIsBoothTransactionOpen}
          booths={booths}
          getBoothById={getBoothById}
        />

        <AddUserDialog
          isOpen={isAddUserDialogOpen}
          onOpenChange={setIsAddUserDialogOpen}
          onUserAdded={handleUserAdded}
        />
        
        <BulkImportDialog
          isOpen={isBulkImportOpen}
          onOpenChange={setIsBulkImportOpen}
        />
        
        <DeleteUserDialog
          isOpen={isDeleteUserDialogOpen}
          onOpenChange={setIsDeleteUserDialogOpen}
          onConfirm={confirmDeleteUser}
          userName={userToDelete?.name || ''}
        />
        
        <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset FraserPay System</DialogTitle>
              <DialogDescription>
                {!resetConfirmation ? (
                  "Please enter the system password to proceed with reset."
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-destructive inline mr-1" />
                    This will delete all booths, transactions, and reset revenue to $0.
                    This action cannot be undone.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            
            {!resetConfirmation ? (
              <>
                <Input
                  type="password"
                  placeholder="Enter password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
                {resetError && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{resetError}</AlertDescription>
                  </Alert>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsResetDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleCheckPassword}>Validate</Button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsResetDialogOpen(false)}>Cancel</Button>
                <Button 
                  variant="destructive" 
                  onClick={handleResetFraserPay}
                  disabled={isResetting}
                >
                  {isResetting ? "Resetting..." : "Confirm Reset"}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
        
        <AuthorizedUsersDialog
          isOpen={isAuthorizedUsersOpen}
          onOpenChange={setIsAuthorizedUsersOpen}
        />
      </div>
    </Layout>
  );
};

export default Dashboard;
